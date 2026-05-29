import { randomUUID } from "crypto";
import { getDb } from "../index.js";
import type {
  Deployment,
  DeploymentBinding,
  DeploymentBindingType,
  DeploymentEvent,
  DeploymentSourceType,
  DeploymentStatus,
} from "../../types.js";

// Deployment state is operational and intentionally NOT synced to the cloud
// portal — no recordChange() calls in this file.

export interface CreateDeploymentInput {
  projectId: string;
  createdBy: string;
  sourceType: DeploymentSourceType;
  sourceRef: string;
  scriptName: string;
  dispatchNamespace: string;
  customHostname?: string | null;
}

export function createDeployment(input: CreateDeploymentInput): Deployment {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO deployments
       (id, project_id, created_by, source_type, source_ref,
        script_name, dispatch_namespace, custom_hostname, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(
    id,
    input.projectId,
    input.createdBy,
    input.sourceType,
    input.sourceRef,
    input.scriptName,
    input.dispatchNamespace,
    input.customHostname ?? null,
  );
  return db.prepare("SELECT * FROM deployments WHERE id = ?").get(id) as Deployment;
}

export function getDeployment(id: string, projectId: string): Deployment | undefined {
  return getDb()
    .prepare("SELECT * FROM deployments WHERE id = ? AND project_id = ?")
    .get(id, projectId) as Deployment | undefined;
}

export function listDeployments(projectId: string): Deployment[] {
  return getDb()
    .prepare(
      "SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId) as Deployment[];
}

export function listLiveDeployments(projectId: string): Deployment[] {
  return getDb()
    .prepare(
      "SELECT * FROM deployments WHERE project_id = ? AND status = 'live' ORDER BY promoted_at DESC",
    )
    .all(projectId) as Deployment[];
}

export interface DeploymentStatusUpdate {
  status: DeploymentStatus;
  failureReason?: string | null;
  customHostname?: string | null;
}

export function updateDeploymentStatus(
  id: string,
  update: DeploymentStatusUpdate,
): Deployment | undefined {
  const db = getDb();
  const fields: string[] = ["status = ?"];
  // Bun's SQLQueryBindings is a strict union; the codebase uses `any[]` for
  // dynamic UPDATE binding lists (matches project-repo / sync-engine pattern).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [update.status];

  if (update.failureReason !== undefined) {
    fields.push("failure_reason = ?");
    values.push(update.failureReason);
  }
  if (update.customHostname !== undefined) {
    fields.push("custom_hostname = ?");
    values.push(update.customHostname);
  }
  if (update.status === "live") {
    fields.push("promoted_at = datetime('now')");
  }
  if (update.status === "torn_down") {
    fields.push("torn_down_at = datetime('now')");
  }

  values.push(id);
  db.prepare(`UPDATE deployments SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM deployments WHERE id = ?").get(id) as Deployment | undefined;
}

// --- Bindings ---

export function recordBinding(binding: DeploymentBinding): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO deployment_bindings
         (deployment_id, binding_name, binding_type, resource_id)
       VALUES (?, ?, ?, ?)`,
    )
    .run(binding.deployment_id, binding.binding_name, binding.binding_type, binding.resource_id);
}

export function listBindings(deploymentId: string): DeploymentBinding[] {
  return getDb()
    .prepare(
      "SELECT * FROM deployment_bindings WHERE deployment_id = ? ORDER BY binding_name",
    )
    .all(deploymentId) as DeploymentBinding[];
}

/**
 * Look up the most recent resource_id for a (project, binding_name, binding_type)
 * across any prior deployment — so a redeploy reattaches the same D1/R2/KV.
 * Returns undefined if this is the first time the binding has been seen.
 */
export function findExistingBindingResource(
  projectId: string,
  bindingName: string,
  bindingType: DeploymentBindingType,
): string | undefined {
  const row = getDb()
    .prepare(
      `SELECT db.resource_id AS resource_id
       FROM deployment_bindings db
       JOIN deployments d ON d.id = db.deployment_id
       WHERE d.project_id = ?
         AND db.binding_name = ?
         AND db.binding_type = ?
       ORDER BY d.created_at DESC
       LIMIT 1`,
    )
    .get(projectId, bindingName, bindingType) as { resource_id: string } | undefined;
  return row?.resource_id;
}

// --- Events ---

export function appendEvent(
  deploymentId: string,
  level: DeploymentEvent["level"],
  message: string,
): DeploymentEvent {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO deployment_events (deployment_id, level, message) VALUES (?, ?, ?)",
    )
    .run(deploymentId, level, message);
  return db
    .prepare("SELECT * FROM deployment_events WHERE id = ?")
    .get(result.lastInsertRowid) as DeploymentEvent;
}

export function listEvents(deploymentId: string, sinceId = 0): DeploymentEvent[] {
  return getDb()
    .prepare(
      "SELECT * FROM deployment_events WHERE deployment_id = ? AND id > ? ORDER BY id ASC",
    )
    .all(deploymentId, sinceId) as DeploymentEvent[];
}
