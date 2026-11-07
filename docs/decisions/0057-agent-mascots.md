# 0057. Agents are small voxel cube mascots drawn in code, lightly customisable

Date: 2026-11-01. Status: accepted. Decided by: Charlie (his note of 2026-11-01: « juste les bulles de couleur ce n'est pas
incroyable … des petits personnages carrés … proposés de base … pas trop customisable ni trop poussé ») + Claude (agents-mascots).

## Context
Every agent was a coloured bubble (a gradient disc) in Équipe, Messages, the inbox, the sheets and the mentions. Eight colours
told nothing about who does what, and thirty-odd bubbles looked the same.

Art direction, the same evening: « des trucs qui ressemblent aux dots de ChatGPT, mais là tu fais vraiment des cubes Minecraft,
quasiment un peu en 3D, très beau design premium » (calm and minimal, but cubic).

## Decision
1. **A character per role, drawn in SVG code as a voxel cube in light isometric 3D**, layered: body, head, face, hair or hat,
   held accessory (`src/renderer/components/mascot/`). Every part is a box of three flat faces (top lightest, side darkest) in a
   2:1 isometric view (`iso.tsx`) over a soft shadow: no image, no font, no gradient, no filter, no `<style>` injected, so it is
   crisp from 16 to 160 px, strict-CSP safe, and the same in dark and light. The accessories are small voxel pieces too. A table typed on `AgentRole` (`roles.ts`) gives each role
   its hat, face piece and default accessory, and does not compile until a new role has one. **Atlas is the base character**
   (plain hair, a compass).
2. **The accessory says the job**: scriptwriter quill, competitor analyst binoculars, QC eye monocle and check-list, pipeline
   architect set square, voice microphone and headphones, editor clapperboard, director megaphone, packaging palette, production
   supervisor stopwatch and hard hat, researcher light bulb, publisher paper plane, partnerships price tag, Big Agent flag.
3. **Customisation stays light**: a body colour (the 8 existing agent colour pairs) and one held accessory from a short list (the
   role's own, 8 common ones, empty hands). Hat and face belong to the role so « who is who » stays readable. Edited on the
   agent's sheet in Équipe (« Son personnage »); a choice equal to the default is stored as nothing, so the character keeps
   following its role.
4. **Stored per agent**: migration 036 adds `orch_agents.look` (JSON, NULL = the role's defaults), a column of its own because
   the sheet replaces the whole `policy` JSON when the effort changes. `orchestra.updateAgent(id, { look })`, checked by
   `checkLook` (`src/shared/mascot.ts`). In a demo workspace the choice lives for the session (`look-store.ts`), like the other
   demo edits.
5. **One component draws them everywhere**: `AgentAvatar` (`components/proto/kit.tsx`) shows the mascot when the agent has a role
   and stays the coloured bubble when the caller only knows a colour. Équipe, Messages (header, messages, typing), Activité, the
   inbox, mentions, sheets and the main agent panel all go through it. The status dot moved to the top-right corner, free of the
   accessory.
6. **A tiny idle animation on hover only** (a blink and a small bob, in `app.css`), still under `prefers-reduced-motion`.

## Consequences
- The old screens (`screens/agents`, `components/conversations`, the onboarding's team assembly) still draw bubbles; they are
  not reached from the app's navigation (or are one-off) and can move to `AgentAvatar` when they are touched.
- A custom role (« Agent sur mesure ») gets the plain character with a gear; a role added later must be added to `ROLE_LOOK`.
- Names of the characters and the style (premium, friendly, flat, rounded-square heads) are Claude's proposal for Charlie to
  confirm; changing them touches only `components/mascot/`.
