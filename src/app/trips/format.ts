// Cost display. Zone costs are the deployed synthetic units. Address costs are
// estimated extra driving SECONDS (docs/ARCHITECTURE-v2.md sections 3 and 5);
// only presentation converts them to minutes, and the exact seconds stay visible.

export type CostUnit = "zone_cost" | "detour_seconds";

export function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** A cost inside a sentence: "cost 7" for zones, "extra 3 min 50 s" for addresses. */
export function formatCost(unit: CostUnit, cost: number): string {
  return unit === "detour_seconds" ? `extra ${formatSeconds(cost)}` : `cost ${cost}`;
}

/** The trip total with its meaning, never a bare number for an address trip. */
export function formatTotal(unit: CostUnit, total: number): string {
  return unit === "detour_seconds"
    ? `Sum of estimated individual pickup detours: ${formatSeconds(total)} (${total} s)`
    : `Total cost: ${total}`;
}
