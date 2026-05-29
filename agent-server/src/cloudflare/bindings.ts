import { accountPath, cfFetch, CloudflareApiError } from "./client.js";
import {
  findExistingBindingResource,
  recordBinding,
} from "../db/repositories/deployment-repo.js";
import type {
  DeploymentBinding,
  DeploymentBindingType,
} from "../types.js";
import type { DeploymentManifest } from "./manifest.js";

/**
 * Provisions or reattaches the bindings declared in a deploy manifest, scoped to
 * a project. For each binding:
 *   1. If a previous deployment in this project used the same (name, type),
 *      reuse the resource_id — guarantees redeploys keep the same D1 / R2 / KV.
 *   2. Otherwise create a new resource in Cloudflare with a deterministic name.
 *
 * The returned shape is what goes into the WfP script-upload metadata.bindings
 * array. resource_id mappings are also persisted in deployment_bindings.
 */

export interface WfpBindingMetadata {
  type: "d1" | "r2_bucket" | "kv_namespace";
  name: string;          // env var name in the Worker
  id?: string;           // D1 uuid / KV namespace id
  database_id?: string;  // alias some Cloudflare endpoints use for D1
  bucket_name?: string;  // R2 bucket name
}

interface D1Database {
  uuid: string;
  name: string;
}

interface KVNamespace {
  id: string;
  title: string;
}

interface R2Bucket {
  name: string;
}

function shortProjectId(projectId: string): string {
  // Use first 8 hex chars of the UUID to keep CF resource names readable.
  return projectId.replace(/-/g, "").slice(0, 8);
}

function resourceName(projectId: string, label: string): string {
  return `sahamati-${shortProjectId(projectId)}-${label.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

async function ensureD1(projectId: string, label: string): Promise<string> {
  const name = resourceName(projectId, label);
  // D1 create is idempotent by name only when the same account; if collisions
  // happen we surface the CF error untouched (no auto-rename — predictable IDs).
  const db = await cfFetch<D1Database>(accountPath("/d1/database"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return db.uuid;
}

async function ensureR2(projectId: string, label: string): Promise<string> {
  const name = resourceName(projectId, label);
  try {
    await cfFetch<R2Bucket>(accountPath("/r2/buckets"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch (err) {
    // 10004 = bucket already exists — treat as success and reuse the name.
    if (err instanceof CloudflareApiError && err.codes.includes(10004)) {
      return name;
    }
    throw err;
  }
  return name;
}

async function ensureKV(projectId: string, label: string): Promise<string> {
  const title = resourceName(projectId, label);
  const ns = await cfFetch<KVNamespace>(accountPath("/storage/kv/namespaces"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return ns.id;
}

async function ensureResource(
  projectId: string,
  bindingName: string,
  type: DeploymentBindingType,
  label: string,
): Promise<string> {
  const existing = findExistingBindingResource(projectId, bindingName, type);
  if (existing) return existing;

  switch (type) {
    case "d1":
      return ensureD1(projectId, label);
    case "r2":
      return ensureR2(projectId, label);
    case "kv":
      return ensureKV(projectId, label);
  }
}

export interface EnsuredBindings {
  metadata: WfpBindingMetadata[];        // for the WfP script upload
  records: DeploymentBinding[];           // for persistence in deployment_bindings
}

export async function ensureBindings(
  projectId: string,
  deploymentId: string,
  manifest: DeploymentManifest,
): Promise<EnsuredBindings> {
  const metadata: WfpBindingMetadata[] = [];
  const records: DeploymentBinding[] = [];

  const decl = manifest.bindings;
  if (!decl) return { metadata, records };

  for (const d1 of decl.d1 ?? []) {
    const id = await ensureResource(projectId, d1.name, "d1", d1.label);
    metadata.push({ type: "d1", name: d1.name, id, database_id: id });
    records.push({
      deployment_id: deploymentId,
      binding_name: d1.name,
      binding_type: "d1",
      resource_id: id,
    });
  }

  for (const r2 of decl.r2 ?? []) {
    const bucket = await ensureResource(projectId, r2.name, "r2", r2.label);
    metadata.push({ type: "r2_bucket", name: r2.name, bucket_name: bucket });
    records.push({
      deployment_id: deploymentId,
      binding_name: r2.name,
      binding_type: "r2",
      resource_id: bucket,
    });
  }

  for (const kv of decl.kv ?? []) {
    const id = await ensureResource(projectId, kv.name, "kv", kv.name);
    metadata.push({ type: "kv_namespace", name: kv.name, id });
    records.push({
      deployment_id: deploymentId,
      binding_name: kv.name,
      binding_type: "kv",
      resource_id: id,
    });
  }

  for (const r of records) recordBinding(r);

  return { metadata, records };
}
