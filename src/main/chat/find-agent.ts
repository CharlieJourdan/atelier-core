// Agent lookup by what a model or Charlie wrote (ask_agent, the lane redirect). Pure.

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Finds an agent by id, name or mention slug, ignoring case, accents and punctuation ("@Voix_off", "voix off", "voiceover"). */
export function findAgent<T extends { id: string; name: string }>(agents: readonly T[], ref: string): T | null {
  const key = fold(ref.replace(/^@/, ''))
  if (!key) return null
  return agents.find((a) => fold(a.id) === key) ?? agents.find((a) => fold(a.name) === key) ?? null
}
