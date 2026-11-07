// Line diff (longest common subsequence) used by the "publish" dialog of the Blueprints page.
export interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
}

export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split('\n')
  const y = b.split('\n')
  const n = x.length
  const m = y.length
  // lcs[i][j] = length of the LCS of x[i..] and y[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = x[i] === y[j] ? (lcs[i + 1]![j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: 'same', text: x[i] ?? '' })
      i++
      j++
    } else if ((lcs[i + 1]![j] ?? 0) >= (lcs[i]![j + 1] ?? 0)) {
      out.push({ kind: 'del', text: x[i] ?? '' })
      i++
    } else {
      out.push({ kind: 'add', text: y[j] ?? '' })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: x[i++] ?? '' })
  while (j < m) out.push({ kind: 'add', text: y[j++] ?? '' })
  return out
}

/** Keeps the changed lines with `context` unchanged lines around them; gaps become a single "…" line. */
export function collapseDiff(lines: DiffLine[], context = 2): (DiffLine | { kind: 'gap'; hidden: number })[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((l, idx) => {
    if (l.kind === 'same') return
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true
  })
  const out: (DiffLine | { kind: 'gap'; hidden: number })[] = []
  let hidden = 0
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (hidden > 0) out.push({ kind: 'gap', hidden })
      hidden = 0
      out.push(l)
    } else hidden++
  })
  if (hidden > 0) out.push({ kind: 'gap', hidden })
  return out
}
