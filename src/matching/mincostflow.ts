// Bounded min-cost max-flow via repeated Bellman-Ford shortest augmenting
// paths. Objective: maximize total flow (accommodated passengers) first, then
// minimize additive pickup cost among maximum-cardinality plans. All per-unit
// edge costs are nonnegative here, so every augmenting path has nonnegative
// length and max-flow coincides with maximum cardinality; Bellman-Ford is used
// because residual reverse edges carry negative costs.
//
// Established algorithm; see the min-cost flow reference cited in
// docs/ARCHITECTURE.md section 6.
//
// Network (architecture section 6):
//   source -> passenger   capacity 1,              cost 0
//   passenger -> driver   capacity 1,              cost = pickup cost
//   driver -> sink        capacity = seatCapacity, cost 0
// Reverse residual edges start at capacity 0 with negated cost.

import {
  type MatchInput,
  type MatchingResult,
  asciiLess,
  buildCostLookup,
  edgeKey,
} from "./types.ts";

export const ALGORITHM_VERSION = "mincostflow-v1";

interface FlowEdge {
  to: number;
  capacity: number;
  cost: number;
  reverse: number; // index of the paired edge in graph[to]
}

export function minCostFlowMatch(input: MatchInput): MatchingResult {
  const lookup = buildCostLookup(input);

  // Stable ASCII UUID ordering fixes node numbering and edge construction.
  const passengerIds = [...input.passengers].map((p) => p.id).sort(asciiLess);
  const drivers = [...input.drivers].sort((a, b) => asciiLess(a.id, b.id));

  const source = 0;
  const sink = 1;
  const passengerNode = new Map<string, number>();
  const driverNode = new Map<string, number>();
  let next = 2;
  for (const id of passengerIds) passengerNode.set(id, next++);
  for (const d of drivers) driverNode.set(d.id, next++);
  const nodeCount = next;

  const graph: FlowEdge[][] = Array.from({ length: nodeCount }, () => []);
  const addEdge = (from: number, to: number, capacity: number, cost: number) => {
    graph[from].push({ to, capacity, cost, reverse: graph[to].length });
    graph[to].push({ to: from, capacity: 0, cost: -cost, reverse: graph[from].length - 1 });
  };

  for (const id of passengerIds) addEdge(source, passengerNode.get(id)!, 1, 0);
  for (const d of drivers) {
    if (d.seatCapacity > 0) addEdge(driverNode.get(d.id)!, sink, d.seatCapacity, 0);
  }
  // Passenger -> driver edges only for compatible pairs. Fixed construction
  // order (passenger ascending, then driver ascending) keeps augmenting
  // choices reproducible.
  for (const passengerId of passengerIds) {
    const p = passengerNode.get(passengerId)!;
    for (const d of drivers) {
      const cost = lookup.get(edgeKey(d.id, passengerId));
      if (cost === undefined) continue;
      addEdge(p, driverNode.get(d.id)!, 1, cost);
    }
  }

  // Repeatedly find a shortest (min-cost) source->sink path over edges with
  // positive residual capacity and augment one unit along it. Because source
  // and passenger->driver edges have unit capacity, each augmentation carries
  // exactly one unit, so we stop when the sink becomes unreachable.
  const INF = Number.POSITIVE_INFINITY;
  for (;;) {
    const dist = new Array<number>(nodeCount).fill(INF);
    const inQueue = new Array<boolean>(nodeCount).fill(false);
    const prevNode = new Array<number>(nodeCount).fill(-1);
    const prevEdge = new Array<number>(nodeCount).fill(-1);
    dist[source] = 0;

    // Bellman-Ford via a SPFA-style queue; handles the negative reverse edges.
    const queue: number[] = [source];
    inQueue[source] = true;
    while (queue.length > 0) {
      const u = queue.shift()!;
      inQueue[u] = false;
      const du = dist[u];
      for (let i = 0; i < graph[u].length; i++) {
        const e = graph[u][i];
        if (e.capacity <= 0) continue;
        const nd = du + e.cost;
        // First predecessor wins on an equal distance: use strict improvement.
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prevNode[e.to] = u;
          prevEdge[e.to] = i;
          if (!inQueue[e.to]) {
            inQueue[e.to] = true;
            queue.push(e.to);
          }
        }
      }
    }

    if (dist[sink] === INF) break; // sink unreachable: flow is maximal

    // Augment one unit along the recovered path.
    let v = sink;
    while (v !== source) {
      const u = prevNode[v];
      const ei = prevEdge[v];
      const e = graph[u][ei];
      e.capacity -= 1;
      graph[e.to][e.reverse].capacity += 1;
      v = u;
    }
  }

  // Reconstruct assignments from saturated passenger->driver forward edges.
  const assignments: MatchingResult["assignments"] = [];
  const assignedPassengers = new Set<string>();
  for (const passengerId of passengerIds) {
    const p = passengerNode.get(passengerId)!;
    for (const e of graph[p]) {
      if (e.to === source) continue; // skip residual edge back to source
      // A forward passenger->driver edge with zero remaining capacity carries
      // one unit of flow.
      if (e.capacity === 0) {
        const driverId = idForNode(driverNode, e.to);
        if (driverId === undefined) continue;
        const cost = lookup.get(edgeKey(driverId, passengerId))!;
        assignments.push({ passengerId, driverId, cost });
        assignedPassengers.add(passengerId);
        break;
      }
    }
  }

  assignments.sort((a, b) => asciiLess(a.passengerId, b.passengerId));
  const unassigned = passengerIds
    .filter((id) => !assignedPassengers.has(id))
    .sort(asciiLess);

  return {
    assignments,
    unassignedPassengerIds: unassigned,
    matchedCount: assignments.length,
    totalCost: assignments.reduce((sum, a) => sum + a.cost, 0),
  };
}

function idForNode(
  driverNode: Map<string, number>,
  node: number,
): string | undefined {
  for (const [id, n] of driverNode) if (n === node) return id;
  return undefined;
}
