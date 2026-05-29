import { basename } from "path";
import { accountPath, cfFetch, getCloudflareConfig } from "./client.js";
import type { WfpBindingMetadata } from "./bindings.js";

/**
 * Workers for Platforms — tenant script upload / delete / list.
 *
 * Critical gotcha: bindings live in the upload METADATA, not in any wrangler
 * config. The bindings array we send here completely replaces whatever was
 * previously attached to the script — callers must always pass the full set
 * (we read them from deployment_bindings, never assume CF retained them).
 */

export interface ScriptModule {
  name: string;            // e.g. "worker.js" (must match the import path used by main_module)
  bytes: Uint8Array;
  contentType: string;     // "application/javascript+module" for ESM, "application/javascript" for service-worker
}

export interface UploadScriptInput {
  scriptName: string;
  mainModule: string;                       // module name that exports default { fetch }
  modules: ScriptModule[];                  // includes mainModule and any imports
  compatibilityDate: string;
  compatibilityFlags?: string[];
  bindings: WfpBindingMetadata[];
  assetsJwt?: string | null;
  runWorkerFirst?: boolean;
}

interface ScriptMetadata {
  main_module: string;
  compatibility_date: string;
  compatibility_flags?: string[];
  bindings: WfpBindingMetadata[];
  assets?: {
    jwt: string;
    config?: { run_worker_first?: boolean };
  };
}

function dispatchScriptPath(scriptName: string): string {
  const cfg = getCloudflareConfig();
  return accountPath(
    `/workers/dispatch/namespaces/${encodeURIComponent(cfg.wfpNamespace)}/scripts/${encodeURIComponent(scriptName)}`,
  );
}

export async function uploadScript(input: UploadScriptInput): Promise<void> {
  const metadata: ScriptMetadata = {
    main_module: input.mainModule,
    compatibility_date: input.compatibilityDate,
    compatibility_flags: input.compatibilityFlags,
    bindings: input.bindings,
  };

  if (input.assetsJwt) {
    metadata.assets = {
      jwt: input.assetsJwt,
      config: input.runWorkerFirst ? { run_worker_first: true } : undefined,
    };
  }

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    "metadata.json",
  );

  let mainSeen = false;
  for (const mod of input.modules) {
    if (mod.name === input.mainModule) mainSeen = true;
    form.append(
      mod.name,
      new Blob([mod.bytes], { type: mod.contentType }),
      basename(mod.name),
    );
  }
  if (!mainSeen) {
    throw new Error(
      `mainModule ${input.mainModule} is not among the provided modules — refusing to upload`,
    );
  }

  await cfFetch<unknown>(dispatchScriptPath(input.scriptName), {
    method: "PUT",
    body: form,
  });
}

export async function deleteScript(scriptName: string): Promise<void> {
  await cfFetch<unknown>(dispatchScriptPath(scriptName), { method: "DELETE" });
}

interface DispatchScript {
  id: string;
  created_on: string;
  modified_on: string;
}

export async function listScripts(): Promise<DispatchScript[]> {
  const cfg = getCloudflareConfig();
  return cfFetch<DispatchScript[]>(
    accountPath(
      `/workers/dispatch/namespaces/${encodeURIComponent(cfg.wfpNamespace)}/scripts`,
    ),
  );
}
