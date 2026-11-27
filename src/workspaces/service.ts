import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { TerminalBusinessError, TransientFailure } from "../contracts/errors.ts";
import { classifyUnkeyedFailure } from "../db/classify.ts";
import { assertDataset } from "../db/dataset.ts";
import { datasetLock } from "../db/local-target.ts";
import { withTransaction } from "../db/transaction.ts";

export const workspaceCookie = "groupride_workspace";
const secretFormat = /^[a-f0-9]{64}$/;
const newSecret = () => randomBytes(32).toString("hex");
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

export function workspaceSecret(request: Request): string | undefined {
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(workspaceCookie + "="));
  return cookie?.slice(workspaceCookie.length + 1);
}

// Lock and recheck in this order. Revocation and trip insertion then serialize
// on the workspace, including when a revoked request was already waiting.
async function lockSession(client: PoolClient, secret?: string) {
  if (!secret || !secretFormat.test(secret)) return;
  const secretHash = hash(secret);
  const owner = await client.query<{ id: string }>(
    `SELECT w.id FROM workspaces w JOIN workspace_sessions s ON s.workspace_id = w.id
     WHERE s.secret_hash = $1 FOR UPDATE OF w`, [secretHash],
  );
  const id = owner.rows[0]?.id;
  if (!id) return;
  const session = await client.query(
    "UPDATE workspace_sessions SET last_used_at = now() WHERE secret_hash = $1 AND workspace_id = $2",
    [secretHash, id],
  );
  if (!session.rowCount) return;
  await client.query("UPDATE workspaces SET last_used_at = now() WHERE id = $1", [id]);
  return { id, secretHash };
}

export async function requireWorkspace(client: PoolClient, secret?: string): Promise<string> {
  const session = await lockSession(client, secret);
  if (!session) throw new TransientFailure("WORKSPACE_REQUIRED", "Establish a workspace and retry with the same key.");
  return session.id;
}

export async function hasWorkspaceSession(client: PoolClient, workspaceId: string, secret: string): Promise<boolean> {
  if (!secretFormat.test(secret)) return false;
  const result = await client.query(
    "SELECT 1 FROM workspace_sessions WHERE workspace_id = $1 AND secret_hash = $2",
    [workspaceId, hash(secret)],
  );
  return result.rowCount === 1;
}

async function issueSession(client: PoolClient, id: string) {
  const secret = newSecret();
  await client.query("INSERT INTO workspace_sessions (secret_hash, workspace_id) VALUES ($1, $2)", [hash(secret), id]);
  return secret;
}

function workspaceTransaction<T>(pool: Pool, mode: "read" | "write", work: (client: PoolClient) => Promise<T>) {
  return withTransaction(pool, mode, async client => {
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    return work(client);
  }).catch(error => { throw classifyUnkeyedFailure(error); });
}

export function bootstrapWorkspace(pool: Pool, secret?: string) {
  return workspaceTransaction(pool, "write", async client => {
    const session = await lockSession(client, secret);
    if (session) return { id: session.id, secret: undefined };
    const created = await client.query<{ id: string }>("INSERT INTO workspaces DEFAULT VALUES RETURNING id");
    const id = created.rows[0].id;
    return { id, secret: await issueSession(client, id) };
  });
}

export function recoverWorkspace(pool: Pool, code: string) {
  return workspaceTransaction(pool, "write", async client => {
    const owner = secretFormat.test(code) && (await client.query<{ id: string }>(
      "SELECT id FROM workspaces WHERE recovery_hash = $1 FOR UPDATE", [hash(code)],
    )).rows[0];
    if (!owner) throw new TerminalBusinessError(404, "NOT_FOUND", "Recovery code is invalid.");
    await client.query("UPDATE workspaces SET last_used_at = now() WHERE id = $1", [owner.id]);
    return { id: owner.id, secret: await issueSession(client, owner.id) };
  });
}

export function readRecoveryVersion(pool: Pool, secret: string | undefined) {
  return workspaceTransaction(pool, "read", async client => {
    const result = secret && secretFormat.test(secret) && (await client.query<{
      workspaceId: string; recoveryVersion: number;
    }>(
      `SELECT w.id AS "workspaceId", w.recovery_version AS "recoveryVersion"
       FROM workspaces w JOIN workspace_sessions s ON s.workspace_id = w.id
       WHERE s.secret_hash = $1`, [hash(secret)],
    )).rows[0];
    if (!result) throw new TerminalBusinessError(409, "WORKSPACE_REQUIRED", "Establish or recover a workspace first.");
    return result;
  });
}

export function manageWorkspace(
  pool: Pool, secret: string | undefined,
  command: { action: "revoke"; expectedWorkspaceId: string } |
    { action: "rotate"; expectedWorkspaceId: string; expectedRecoveryVersion: number },
) {
  return workspaceTransaction(pool, "write", async client => {
    const session = await lockSession(client, secret);
    if (!session) throw new TerminalBusinessError(409, "WORKSPACE_REQUIRED", "Establish or recover a workspace first.");
    if (session.id !== command.expectedWorkspaceId) {
      throw new TerminalBusinessError(409, "WORKSPACE_CHANGED", "The workspace changed. Review it and choose the action again.");
    }
    if (command.action === "rotate") {
      const code = newSecret();
      const updated = await client.query<{ recovery_version: number }>(
        `UPDATE workspaces SET recovery_hash = $1, recovery_version = recovery_version + 1
         WHERE id = $2 AND recovery_version = $3 RETURNING recovery_version`,
        [hash(code), session.id, command.expectedRecoveryVersion],
      );
      if (!updated.rowCount) {
        const current = await client.query<{ recovery_version: number }>(
          "SELECT recovery_version FROM workspaces WHERE id = $1", [session.id],
        );
        throw new TerminalBusinessError(
          409, "RECOVERY_VERSION_CHANGED", "The recovery code changed. Choose Rotate recovery code again.",
          { currentVersion: current.rows[0].recovery_version },
        );
      }
      return { workspaceId: session.id, recoveryCode: code, recoveryVersion: updated.rows[0].recovery_version };
    }
    const result = await client.query(
      "DELETE FROM workspace_sessions WHERE workspace_id = $1 AND secret_hash <> $2",
      [session.id, session.secretHash],
    );
    return { workspaceId: session.id, revoked: result.rowCount };
  });
}
