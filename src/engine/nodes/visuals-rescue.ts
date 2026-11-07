// issue #96: when nothing at all was found for a video, each item gets a second chance with a wider query (its subject, else the
// first words) on the archives then the Cloud's chain, before the run stops. Called by visuals.fulfil@1 before it fills the holds.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { GenItem } from '../formats/editplan'
import type { RunCtx } from '../registry'
import { findStock, isStockItem, widerQuery, type StockCredit } from './visuals-stock'
import { toStill, type Sized } from './visuals-stills'

interface Record_ {
  degraded?: string
  demo: boolean
  licence: string
  stock?: StockCredit
}

/** Fills the holds it can (mutating `files`, `record`, `holds`, `gaps`); returns how many searches it made. */
export async function rescueGaps(
  ctx: RunCtx,
  st: { items: GenItem[]; holds: number[]; gaps: string[]; files: string[]; record: Record_[]; keys: string[]; dir: string; size: Sized; archives: boolean }
): Promise<number> {
  let searches = 0
  for (const i of [...st.holds]) {
    const item = st.items[i] as GenItem
    const wide = isStockItem(item) ? widerQuery(item, item.query ?? item.prompt ?? item.context.subject) : null
    if (!wide) continue
    const dir = path.join(st.dir, `wide-${item.id}`)
    await mkdir(dir, { recursive: true })
    searches++
    const found = await findStock(ctx, item, wide, st.size, { idempotencyKey: `stock-wide-${st.keys[i]}`, dir, ...(st.archives ? { archives: true } : {}) }).catch((e: unknown) => {
      if (ctx.signal.aborted) throw e
      ctx.emit({ kind: 'log', level: 'warn', text: `${item.id}: the wider search failed: ${(e as Error).message.slice(0, 200)}` })
      return null
    })
    if (!found) continue
    const out = path.join(st.dir, `${String(i + 1).padStart(3, '0')}-${item.id}.jpg`)
    await toStill(ctx, found.src, out, st.size)
    st.files[i] = out
    const { degraded: _gap, ...rec } = st.record[i] as Record_
    st.record[i] = { ...rec, demo: found.demo, licence: found.credit.licence, stock: found.credit }
    st.holds.splice(st.holds.indexOf(i), 1)
    st.gaps.splice(st.gaps.indexOf(item.id), 1)
    ctx.emit({ kind: 'log', level: 'warn', text: `${item.id}: found with the wider query « ${wide} »` })
  }
  return searches
}
