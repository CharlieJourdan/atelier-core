// Saved previews per technology (production-15, Charlie 01/11): a small gallery of samples already made for each engine and
// style — a few stills, a few seconds of clip or presenter — made once, stored, and shown free, so the owner sees what a
// choice looks like before spending. The app ships a set made on the fakes (`resources/previews`, `npm run previews:seed`);
// real samples made by the model tests are saved beside them (the app's data folder) and win over the shipped ones.
export const PREVIEWS_SCHEMA = 'atelier.previews/1'

export const PREVIEW_FAMILIES = ['image', 'clip', 'presenter'] as const
export type PreviewFamily = (typeof PREVIEW_FAMILIES)[number]

export interface PreviewFile {
  /** Relative to the preview set's folder; read through `previews.file(key, ref)`. */
  ref: string
  type: 'image' | 'video'
}

export interface PreviewItem {
  /** An engine id (`image:gpt-image-25-low`), a style name (`style:phone-real`) or an option value (`option:chapters:true`). */
  key: string
  /** `option`: a before / after of an option a user may pick (pipeline-ui, `resources/option-previews`). */
  kind: 'engine' | 'style' | 'option'
  family: PreviewFamily
  label: string
  /** `demo`: drawn on the fakes; `real`: made by the real engine. */
  source: 'demo' | 'real'
  madeAt: string
  files: PreviewFile[]
}

export interface PreviewManifest {
  schema: typeof PREVIEWS_SCHEMA
  items: PreviewItem[]
}
