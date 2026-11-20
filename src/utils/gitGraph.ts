// Lane layout for the commit graph. Pure: no DOM, no stores.
//
// Commits must come in an order where children precede parents (`git log --topo-order`).
// Each row is drawn in two halves: `top` edges run from the row's upper border to its
// middle, `bottom` edges from the middle to the lower border. `from`/`to` are lane indexes.

export interface GraphCommit {
  hash: string;
  parents: readonly string[];
}

export interface GraphEdge {
  from: number;
  to: number;
  color: number;
}

export interface GraphRow {
  hash: string;
  lane: number;
  /** Index of the lane's colour; map it to a palette with `% palette.length`. */
  color: number;
  top: GraphEdge[];
  bottom: GraphEdge[];
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Number of lanes needed by the widest row. */
  laneCount: number;
}

interface Lane {
  /** The commit this lane is heading to. */
  hash: string;
  color: number;
}

export function layoutGraph(commits: readonly GraphCommit[]): GraphLayout {
  const lanes: (Lane | null)[] = [];
  const rows: GraphRow[] = [];
  let nextColor = 0;
  let laneCount = 0;

  const allocate = (hash: string): number => {
    let index = lanes.indexOf(null);
    if (index === -1) index = lanes.length;
    lanes[index] = { hash, color: nextColor++ };
    return index;
  };

  for (const commit of commits) {
    const top: GraphEdge[] = [];
    const bottom: GraphEdge[] = [];

    // Lanes of the children that point at this commit.
    const incoming: number[] = [];
    lanes.forEach((lane, i) => {
      if (lane?.hash === commit.hash) incoming.push(i);
    });

    let lane: number;
    let color: number;
    if (incoming.length > 0) {
      lane = incoming[0];
      color = (lanes[lane] as Lane).color;
    } else {
      // Nothing above refers to it: a branch tip, starts a new lane.
      lane = allocate(commit.hash);
      color = (lanes[lane] as Lane).color;
    }

    lanes.forEach((l, i) => {
      if (!l) return;
      if (l.hash !== commit.hash) top.push({ from: i, to: i, color: l.color });
      else if (incoming.length > 0) top.push({ from: i, to: lane, color: l.color });
    });

    for (const i of incoming) lanes[i] = null;
    lanes[lane] = null;

    // Lanes that just pass by this row; `to` may change if a lane is pulled left below.
    const passing = new Map<number, GraphEdge>();
    lanes.forEach((l, i) => {
      if (l) passing.set(i, { from: i, to: i, color: l.color });
    });

    const parents = [...new Set(commit.parents)];
    parents.forEach((parent, parentIndex) => {
      const existing = lanes.findIndex((l) => l?.hash === parent);
      if (parentIndex === 0) {
        if (existing === -1) {
          lanes[lane] = { hash: parent, color };
          bottom.push({ from: lane, to: lane, color });
        } else if (existing < lane) {
          // Another lane to the left already leads to this parent: join it.
          bottom.push({ from: lane, to: existing, color });
        } else {
          // The parent is tracked further right: pull that lane over to keep the trunk left.
          const moved = lanes[existing] as Lane;
          lanes[existing] = null;
          lanes[lane] = { hash: parent, color };
          bottom.push({ from: lane, to: lane, color });
          const edge = passing.get(existing);
          if (edge) edge.to = lane;
          else bottom.push({ from: existing, to: lane, color: moved.color });
        }
      } else if (existing === -1) {
        const target = allocate(parent);
        bottom.push({ from: lane, to: target, color: (lanes[target] as Lane).color });
      } else {
        bottom.push({ from: lane, to: existing, color: (lanes[existing] as Lane).color });
      }
    });

    bottom.push(...passing.values());

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    for (const edge of [...top, ...bottom]) {
      laneCount = Math.max(laneCount, edge.from + 1, edge.to + 1);
    }
    laneCount = Math.max(laneCount, lane + 1);

    rows.push({ hash: commit.hash, lane, color, top, bottom });
  }

  return { rows, laneCount };
}
