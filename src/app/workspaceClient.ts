import type { RecoveryRotationNotice } from "./recoveryDisplay.ts";

type WorkspaceCommand =
  | { action: "bootstrap" }
  | { action: "rotate" | "revoke"; expectedWorkspaceId: string }
  | { action: "recover"; code: string };

export const rotationNoticeKey = "groupride-recovery-rotation";

let channel: BroadcastChannel | undefined;

function postRotationNotice(event: RecoveryRotationNotice) {
  try {
    // All tabs receive storage events even when only some have BroadcastChannel.
    localStorage.setItem(rotationNoticeKey, JSON.stringify(event));
  } catch {
    workspaceChannel()?.postMessage(event);
    return;
  }
  try { localStorage.removeItem(rotationNoticeKey); } catch { /* the notice contains no secret */ }
}

export function workspaceChannel() {
  if (typeof BroadcastChannel === "undefined") return;
  // Reuse the same channel within this tab so it never handles its own notice.
  return channel ??= new BroadcastChannel("groupride-workspace");
}

export class WorkspaceCommandError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export async function workspaceCommand(
  command: WorkspaceCommand,
  onRotation?: (event: RecoveryRotationNotice, value?: string) => void,
) {
  const send = async () => {
    const report = (event: RecoveryRotationNotice, value?: string) => {
      onRotation?.(event, value);
      postRotationNotice(event);
    };
    const rotation = command.action === "rotate"
      ? { workspaceId: command.expectedWorkspaceId, requestId: crypto.randomUUID() }
      : null;
    const read = async (response: Response) => (await response.json()) as {
      workspaceId: string;
      recoveryCode?: string;
      recoveryVersion?: number;
      error?: { code?: string; message?: string; currentVersion?: number };
    };
    const failure = (body: Awaited<ReturnType<typeof read>>) =>
      new WorkspaceCommandError(body.error?.message ?? "Could not open the workspace.", body.error?.code);
    let payload: WorkspaceCommand & { expectedRecoveryVersion?: number } = command;
    if (rotation) {
      const response = await fetch("/api/workspace?recovery-version", {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const current = await read(response);
      if (!response.ok) throw failure(current);
      if (current.workspaceId !== rotation.workspaceId) {
        throw new WorkspaceCommandError("The workspace changed. Review it and choose the action again.", "WORKSPACE_CHANGED");
      }
      if (typeof current.recoveryVersion !== "number" || !Number.isSafeInteger(current.recoveryVersion)) {
        throw new WorkspaceCommandError("Could not read the current recovery-code version.");
      }
      // Pin the command once. A delayed request retains this version even
      // if the browser times out and the organizer starts a fresh rotation.
      payload = { ...command, expectedRecoveryVersion: current.recoveryVersion };
      report({ type: "rotation-started", ...rotation });
    }
    let version: number | null = null;
    let code: string | undefined;
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const body = await read(response);
      if (!response.ok) {
        const currentVersion = body.error?.currentVersion;
        if (body.error?.code === "RECOVERY_VERSION_CHANGED" && typeof currentVersion === "number" &&
            Number.isSafeInteger(currentVersion)) version = currentVersion;
        throw failure(body);
      }
      if (rotation) {
        if (body.workspaceId !== rotation.workspaceId || !Number.isSafeInteger(body.recoveryVersion) ||
            typeof body.recoveryCode !== "string") {
          throw new WorkspaceCommandError("Could not confirm recovery-code rotation.");
        }
        version = body.recoveryVersion!;
        code = body.recoveryCode;
      } else if (command.action !== "revoke") {
        workspaceChannel()?.postMessage({ type: "workspace", workspaceId: body.workspaceId });
      }
      return body;
    } finally {
      if (rotation) report({ type: "rotation-finished", version, ...rotation }, code);
    }
  };
  return navigator.locks ? navigator.locks.request("groupride-workspace", send) : send();
}
