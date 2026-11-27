// Process-local counters for address previews (docs/ARCHITECTURE-v2.md sections
// 5 and 7). Counts only: no addresses, coordinates or participant names ever
// reach a counter or a log line.

export const addressCounters = {
  /** A stored reuse candidate failed validation and was discarded (an invariant failure). */
  reuseCandidateDiscarded: 0,
  /** An estimated detour was negative and clamped to zero (a profile-quality signal). */
  negativeDetourClamped: 0,
  travelTimeWriteFailed: 0,
  travelTimePurgeFailed: 0,
};

export function resetAddressCounters(): void {
  addressCounters.reuseCandidateDiscarded = 0;
  addressCounters.negativeDetourClamped = 0;
  addressCounters.travelTimeWriteFailed = 0;
  addressCounters.travelTimePurgeFailed = 0;
}
