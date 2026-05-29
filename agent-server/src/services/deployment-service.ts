import { readFileSync, existsSync, statSync } from "fs";
import { isAbsolute, join, normalize, resolve, relative, sep } from "path";
import {
  DeploymentManifestSchema,
  type DeploymentManifest,
} from "../cloudflare/manifest.js";
import { ensureBindings } from "../cloudflare/bindings.js";
import { uploadAssetsDirectory } from "../cloudflare/assets.js";
import { uploadScript, deleteScript, type ScriptModule } from "../cloudflare/wfp.js";
import { getCloudflareConfig, CloudflareApiError } from "../cloudflare/client.js";
import { resolveSource, readManifestPath } from "./deployment-source.js";
import {
  appendEvent,
  createDeployment,
  getDeployment,
  updateDeploymentStatus,
} from "../db/repositories/deployment-repo.js";
import type {
  Deployment,
  DeploymentCreateRequest,
} from "../types.js";

/**
 * Orchestrates a deployment:
 *   1. resolve source       (git clone into temp dir)
 *   2. validate manifest    (Zod boundary check)
 *   3. ensure bindings      (D1 / R2 / KV — reattach across redeploys)
 *   4. upload static assets (if manifest.static_assets)
 *   5. upload script        (Workers for Platforms PUT)
 *   6. mark live + persist
 *
 * The kick-off is non-blocking — POST /deployments creates the row in
 * `pending` and returns; this function then runs in the background and
 * appends events for the SSE log stream.
 */

const SCRIPT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

interface KickoffInput {
  projectId: string;
  userId: string;
  source: DeploymentCreateRequest["source"];
}

export function startDeployment(input: KickoffInput): Deployment {
  const cfg = getCloudflareConfig();
  const seq = Date.now().toString(36);
  const projectShort = input.projectId.replace(/-/g, "").slice(0, 8);
  const scriptName = `proj-${projectShort}-${seq}`;

  const deployment = createDeployment({
    projectId: input.projectId,
    createdBy: input.userId,
    sourceType: input.source.type,
    sourceRef: input.source.type === "git" ? input.source.repoUrl : input.source.url,
    scriptName,
    dispatchNamespace: cfg.wfpNamespace,
  });

  // Fire and forget — the route handler returns immediately. Errors are
  // captured back into deployment_events and deployments.failure_reason.
  void runDeployment(deployment, input.source).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    appendEvent(deployment.id, "error", `unhandled: ${msg}`);
    updateDeploymentStatus(deployment.id, { status: "failed", failureReason: msg });
  });

  return deployment;
}

async function runDeployment(
  deployment: Deployment,
  source: DeploymentCreateRequest["source"],
): Promise<void> {
  let cleanup: (() => void) | null = null;
  try {
    appendEvent(deployment.id, "info", "resolving source");
    const resolved = await resolveSource(source);
    cleanup = resolved.cleanup;

    // Persist the resolved source_ref (with commit SHA) — overrides the
    // bare URL we wrote at kick-off.
    updateDeploymentStatus(deployment.id, { status: "building" });
    appendEvent(deployment.id, "info", `source resolved: ${resolved.sourceRef}`);

    const manifestPath = readManifestPath(resolved.workDir);
    if (!manifestPath) {
      throw new Error("sahamati.deploy.json not found at repository root");
    }
    const manifest = DeploymentManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, "utf-8")),
    );
    appendEvent(deployment.id, "info", `manifest: name=${manifest.name} entrypoint=${manifest.entrypoint}`);

    appendEvent(deployment.id, "info", "provisioning bindings");
    const { metadata: bindingMetadata } = await ensureBindings(
      deployment.project_id,
      deployment.id,
      manifest,
    );
    if (bindingMetadata.length > 0) {
      appendEvent(deployment.id, "info", `bindings ready: ${bindingMetadata.map((b) => `${b.name}(${b.type})`).join(", ")}`);
    }

    updateDeploymentStatus(deployment.id, { status: "uploading" });

    let assetsJwt: string | null = null;
    if (manifest.static_assets) {
      const assetsDir = safeJoin(resolved.workDir, manifest.static_assets.directory);
      if (!existsSync(assetsDir) || !statSync(assetsDir).isDirectory()) {
        throw new Error(`static_assets.directory not found: ${manifest.static_assets.directory}`);
      }
      appendEvent(deployment.id, "info", `uploading static assets from ${manifest.static_assets.directory}`);
      assetsJwt = await uploadAssetsDirectory(assetsDir);
    }

    const entryAbs = safeJoin(resolved.workDir, manifest.entrypoint);
    if (!existsSync(entryAbs) || !statSync(entryAbs).isFile()) {
      throw new Error(`entrypoint not found: ${manifest.entrypoint}`);
    }
    const entryRel = relative(resolved.workDir, entryAbs).split(sep).join("/");
    const modules: ScriptModule[] = [
      {
        name: entryRel,
        bytes: readFileSync(entryAbs),
        contentType: "application/javascript+module",
      },
    ];

    appendEvent(deployment.id, "info", `uploading worker script as ${deployment.script_name}`);
    await uploadScript({
      scriptName: deployment.script_name,
      mainModule: entryRel,
      modules,
      compatibilityDate: manifest.compatibility_date,
      compatibilityFlags: manifest.compatibility_flags,
      bindings: bindingMetadata,
      assetsJwt,
      runWorkerFirst: manifest.static_assets?.run_worker_first,
    });

    // Custom hostname wiring is deferred to a follow-up (plan open item).
    // For MVP the script is reachable via the dispatch namespace router that
    // the platform owner deploys separately (one outer Worker, env binding to
    // the namespace, routes `<script_name>.<base-host>` to that script).
    const hostname = null;

    if (!SCRIPT_NAME_RE.test(deployment.script_name)) {
      throw new Error("internal: generated script name failed validation");
    }

    updateDeploymentStatus(deployment.id, {
      status: "live",
      customHostname: hostname,
      failureReason: null,
    });
    appendEvent(deployment.id, "info", "deployment live");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendEvent(deployment.id, "error", sanitizeCloudflareError(msg));
    updateDeploymentStatus(deployment.id, {
      status: "failed",
      failureReason: sanitizeCloudflareError(msg),
    });
  } finally {
    if (cleanup) cleanup();
  }
}

/**
 * Tear down a deployment: delete the WfP script. Per-project bindings
 * (D1/R2/KV) are intentionally NOT deleted unless `purgeBindings` is true —
 * preserves data across redeploys.
 */
export async function teardownDeployment(
  deploymentId: string,
  projectId: string,
  purgeBindings = false,
): Promise<Deployment | undefined> {
  void purgeBindings; // reserved — purge path is a Phase 2 admin tool

  const deployment = getDeployment(deploymentId, projectId);
  if (!deployment) return undefined;

  try {
    await deleteScript(deployment.script_name);
    appendEvent(deploymentId, "info", `deleted WfP script ${deployment.script_name}`);
  } catch (err) {
    if (err instanceof CloudflareApiError && err.status === 404) {
      // Script already gone — fine, still mark torn_down locally.
      appendEvent(deploymentId, "warn", "WfP script already absent");
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      appendEvent(deploymentId, "error", `teardown: ${sanitizeCloudflareError(msg)}`);
      throw err;
    }
  }

  return updateDeploymentStatus(deploymentId, { status: "torn_down" });
}

function safeJoin(base: string, child: string): string {
  if (isAbsolute(child)) {
    throw new Error(`manifest path must be relative: ${child}`);
  }
  const target = normalize(resolve(base, child));
  const baseN = normalize(resolve(base)) + sep;
  if (!target.startsWith(baseN) && target !== normalize(resolve(base))) {
    throw new Error(`manifest path escapes source root: ${child}`);
  }
  return target;
}

/**
 * Strip the Bearer token out of any Cloudflare error string before it lands
 * in the events table. Defensive — cfFetch never embeds it, but if a future
 * wrapper does, we don't want it leaking through SSE to the browser.
 */
function sanitizeCloudflareError(s: string): string {
  return s.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer <redacted>");
}
