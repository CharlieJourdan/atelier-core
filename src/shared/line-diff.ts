// A small line diff (longest common subsequence), for pipeline and style versions. Pure; O(n × m) memory, which is fine
// for documents of a few hundred lines (inputs above MAX_LINES fall back to "all removed, all added").
import type { DiffLine } from './analysis'

export const MAX_LINES = 4000

export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a === '' ? [] : a.split('\n')
  const y = b === '' ? [] : b.split('\n')
  if (x.length > MAX_LINES || y.length > MAX_LINES) {
    return [...x.map((text) => ({ kind: 'del' as const, text })), ...y.map((text) => ({ kind: 'add' as const, text }))]
  }
  const n = x.length
  const m = y.length
  // lcs[i][j] = length of the LCS of x[i..] and y[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] as Uint32Array
    const next = lcs[i + 1] as Uint32Array
    for (let j = m - 1; j >= 0; j--) {
      row[j] = x[i] === y[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, row[j + 1] as number)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: 'same', text: x[i] as string })
      i++
      j++
    } else if ((lcs[i + 1] as Uint32Array)[j] as number >= ((lcs[i] as Uint32Array)[j + 1] as number)) {
      out.push({ kind: 'del', text: x[i] as string })
      i++
    } else {
      out.push({ kind: 'add', text: y[j] as string })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: x[i++] as string })
  while (j < m) out.push({ kind: 'add', text: y[j++] as string })
  return out
}

export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.kind === 'add') added++
    else if (l.kind === 'del') removed++
  }
  return { added, removed }
}
