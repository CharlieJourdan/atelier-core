// Archives that did not answer (throttled past their retries, down), counted per run so that « nothing found » is only said when
// every source truly answered empty (issue #106).
const trouble = new WeakMap<object, number>()

/** A search the archives did not answer for this run: its empty hands are not « nothing found ». */
export function noteArchiveTrouble(ctx: object, n = 1): void {
  trouble.set(ctx, (trouble.get(ctx) ?? 0) + n)
}
export const archiveTroubleOf = (ctx: object): number => trouble.get(ctx) ?? 0
