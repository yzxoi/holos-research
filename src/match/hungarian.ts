/**
 * Hungarian algorithm for optimal assignment.
 * Simplified Kuhn-Munkres for rectangular cost matrices (n ≤ ~30).
 */

const COST_PADDING = 100; // Padding for rectangular cost matrices (unmatched pairs)

/**
 * Returns an array where result[i] = j (assigned column) or -1 if unassigned.
 */
export function hungarian(cost: number[][], rows: number, cols: number): number[] {
  const size = Math.max(rows, cols);
  // Pad to square
  const c: number[][] = [];
  for (let i = 0; i < size; i++) {
    c[i] = [];
    for (let j = 0; j < size; j++) {
      c[i]![j] = i < rows && j < cols ? cost[i]![j]! : COST_PADDING;
    }
  }

  const n = size;
  const u = new Float64Array(n + 1); // dual variable for rows
  const v = new Float64Array(n + 1); // dual variable for columns
  const p = new Int32Array(n + 1); // column-to-row assignment: p[j] = row matched to column j
  const way = new Int32Array(n + 1); // augmenting path: way[j] = predecessor column

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = -1;

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = c[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]!) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    // Restore path
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Array(rows).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (p[j]! >= 1 && p[j]! <= rows && j >= 1 && j <= cols) {
      result[p[j]! - 1] = j - 1;
    }
  }

  return result;
}
