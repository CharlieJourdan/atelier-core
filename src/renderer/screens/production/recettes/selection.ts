// Which recipe the editor opens on (a route has no parameter): the start screen sets it before routing to the editor,
// the editor takes it once on mount. `null`: a new recipe. `agent`: the editor brings « Parler à l'agent » into view
// (« Ajouter à mes pipelines → Modifier », production-lab).
let wanted: number | null = null
let toAgent = false

export function openRecipeNext(id: number | null, opts: { agent?: boolean } = {}): void {
  wanted = id
  toAgent = opts.agent === true
}

export function takeRecipeToOpen(): number | null {
  const id = wanted
  wanted = null
  return id
}

/** The editor should open on the agent (taken once). */
export function takeAgentFocus(): boolean {
  const v = toAgent
  toAgent = false
  return v
}

// The projects page opens its « Nouvelle vidéo » form when the Lab asks (« Nouvelle vidéo », « Utiliser cette pipeline »),
// on the pipeline given (null: the first one).
let form: { recipeId: number | null } | null = null

export function openNewVideoNext(recipeId: number | null): void {
  form = { recipeId }
}

export function takeNewVideo(): { recipeId: number | null } | null {
  const f = form
  form = null
  return f
}
