export type RecoveryRotationNotice = {
  workspaceId: string;
  requestId: string;
} & ({ type: "rotation-started" } | { type: "rotation-finished"; version: number | null });

type RecoveryCode = { workspaceId: string; value: string; version: number };
type PendingRotation = { workspaceId: string; uncertain: boolean };

export type RecoveryDisplay = {
  code: RecoveryCode | null;
  pending: ReadonlyMap<string, PendingRotation>;
  versions: ReadonlyMap<string, number>;
};

export function applyRotation(
  state: RecoveryDisplay, event: RecoveryRotationNotice, value?: string,
): RecoveryDisplay {
  const { workspaceId, requestId } = event;
  const pending = new Map(state.pending);
  if (event.type === "rotation-started") {
    pending.set(requestId, { workspaceId, uncertain: false });
    return { ...state, pending };
  }

  const started = pending.get(requestId);
  pending.delete(requestId);
  const ownCode = state.code?.workspaceId === workspaceId ? state.code : null;
  if (event.version === null) {
    // A failed reply may hide a committed rotation. Also discard candidates
    // from requests already in flight when that uncertainty was discovered.
    for (const [id, rotation] of pending) {
      if (rotation.workspaceId === workspaceId) pending.set(id, { ...rotation, uncertain: true });
    }
    return { ...state, pending, code: ownCode ? null : state.code };
  }

  const latest = state.versions.get(workspaceId) ?? 0;
  if (event.version < latest) return { ...state, pending };
  const versions = new Map(state.versions).set(workspaceId, event.version);
  const code = value && started && !started.uncertain
    ? { workspaceId, value, version: event.version }
    : ownCode && ownCode.version < event.version ? null : state.code;
  return { code, pending, versions };
}

export function visibleRecoveryCode(state: RecoveryDisplay, workspaceId: string | null): string | undefined {
  if (!state.code || state.code.workspaceId !== workspaceId) return;
  if ([...state.pending.values()].some(rotation => rotation.workspaceId === workspaceId)) return;
  return state.code.value;
}
