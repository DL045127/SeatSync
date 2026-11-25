import { normalizeTimestamp } from "../../contracts/normalize.ts";

const hour = 60 * 60 * 1000;

/** Resolve the possible UTC instants for a local calendar date and minute. */
export function departureInstants(date: string, time: string, timeZone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !timeZone) return [];

  const wallTime = Date.parse(normalizeTimestamp(`${date}T${time}:00Z`));
  const formatter = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" });
  function offsetAt(instant: number): number {
    const label = formatter.formatToParts(instant).find(part => part.type === "timeZoneName")?.value;
    if (label === "GMT") return 0;
    const offset = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(label ?? "");
    if (!offset) throw new RangeError("Time zone offset unavailable.");
    const [, sign, hours, minutes, seconds = "0"] = offset;
    return (sign === "-" ? -1 : 1) * (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000;
  }

  // Probe either side of a civil-time transition, then verify each candidate
  // against the offset actually in effect at that instant.
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 6) offsets.add(offsetAt(wallTime + delta * hour));
  return [...offsets]
    .map(offset => wallTime - offset)
    .filter(instant => instant + offsetAt(instant) === wallTime)
    .sort((a, b) => a - b)
    .map(instant => new Date(instant).toISOString());
}
