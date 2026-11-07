# Organisation du dépôt

Choix de départ : **garder le code là où il était**. Déplacer des dossiers aurait cassé des centaines d'imports, les
configurations TypeScript, Vite, ESLint et Vitest, pour un gain faible. Un dépôt qui **compile** et dont les **tests
passent** vaut mieux qu'un bel arbre. Le renderer Electron reste donc dans `src/renderer/` ; c'est la référence
d'écrans de la future app web (`docs/ECRANS.md`).

## L'arbre

| Chemin | Contenu |
|---|---|
| `src/engine/` | **le moteur vidéo** (pur TypeScript + ffmpeg, aucun import d'Electron ni de `src/main`) |
| `src/engine/nodes/` | un fichier par nœud de pipeline (script, voix, réalisateur, visuels, rendu, QC…) ; `productionRegistry()` |
| `src/engine/technologies/` | briques (technologies), recettes et leur compilateur ; `bases/` = les pipelines de base |
| `src/engine/sourcing/` | recherche de médias (archives, banques, extraits), statut légal |
| `src/engine/motion/`, `formats/` | kit motion, cartes, studio three.js |
| `src/engine/review/` | agent de revue du montage et contrôles bloquants |
| `src/engine/watch/` | analyse forensique d'une vidéo (plans, palette, cadence) |
| `src/engine/render/`, `media/` | montage ffmpeg, audio, sous-titres, navigateur de rendu, ménage disque |
| `src/engine/remote-render/` | rendu sur une autre machine (expérimental) |
| `src/main/` | **le cerveau** : `core.ts` construit les services ; `api/` = une méthode IPC par domaine |
| `src/main/production/clone/` | **le moteur de clonage** P0–P10 ; `reverse/` = la rétro-ingénierie ; `analysis/` ; `definition/` ; `pipeline/` ; `compare/` |
| `src/main/production/` | runs du moteur, recettes, projets, agent de style, crédits |
| `src/main/orchestra/`, `agents/`, `mcp/`, `discord/` | runtime des agents, rôles, outils MCP, pont Discord |
| `src/main/eyes/`, `analysis/` | lecture des vidéos et des chaînes |
| `src/main/headless/`, `brain/`, `remote/` | le cerveau sans Electron (ordinateur d'équipe), gardien, relais |
| `src/main/db/migrations/` | migrations SQLite de l'app (numérotées, figées) |
| `src/shared/` | contrats partagés : `api/` (IPC), `cloud-api.ts` (HTTP Cloud), `clone/`, `reverse/`, textes `fr*.ts` / `en*.ts` |
| `src/renderer/` | **référence d'écrans** (React 19) : `screens/`, `components/`, `proto/` (store démo/live) |
| `cloud/` | **Atelier Cloud** : `src/http/` routes, `providers/` adaptateurs, `billing/`, `machines/`, `relay/`, `render/`, `db/migrations/` ; `tests/` |
| `web/` | site web (landing, inscription, prix, console fondateur) |
| `scripts/` | outils et démos (voir plus bas) |
| `tests/` | `unit/` (vitest), `e2e/` (Playwright Electron), `packaged/`, `fixtures/`, `setup/` |
| `resources/` | fichiers livrés avec l'app : schémas JSON, cartes, banque SFX CC0, musiques, aperçus d'options |
| `deploy/` | installation du Cloud (Caddy, systemd, Litestream), worker de rendu, ordinateur d'équipe, worker GPU |
| `docs/` | documentation (voir `docs/README.md`) |

## Les scripts gardés

- Outils : `cleanroom-check.mjs`, `gen-schemas.mjs` (`npm run schemas`), `ts-resolve.mjs` / `ts-transpile*.mjs`
  (chargeurs TypeScript pour Node), `release.ts`, `smoke-cloud.ts`, `smoke-agent.ts`, `render-job.ts`,
  `edit-review.ts` (revue d'un film déjà fait), `blocking-proof.ts` (contrôles bloquants sur un film).
- Démos du moteur (`npm run engine:*`) : `engine-demo.ts`, `engine-dialogue-demo.ts`, `engine-avatar-demo.ts`,
  `engine-avatar-base-demo.ts`, `engine-story-demo.ts`, `engine-reddit-demo.ts`, `engine-documentary2-demo.ts`,
  `engine-motion-demo.ts`, `engine-motion-kit-demo.ts`, `engine-brick-demo.ts`, `engine-promo-demo.ts`,
  `engine-style-demo.ts`, `motion-studio-demo.ts`, `map3d-demo.ts`, `media-proof.ts`.
- Agents et machines : `orchestra-demo.ts`, `orchestra-week.ts`, `brain-run*.mjs`, `vps-brain.mjs`, `vps-sim.mjs`,
  `fake-render-remote.ts`, `team-pc-drill*.ts`, `beta/team-pc.ps1`.
- Génération de ressources : `make-sfx-bank.mjs`, `make-music.mjs`, `make-fake-media.mjs`, `sfx-library-fetch.ts`,
  `maps-build.py`, `previews-seed.ts`, `option-previews-seed.ts`.
- Mac : `mac-verify.sh`, `e2e-gate.mjs`, `verify-summary.mjs`.

## Ce qui a été retiré par rapport à l'ancien dépôt

- L'historique git (dépôt neuf).
- L'ancienne interface v1 (« Écrans v1 (ancien) ») : `LegacyHost`, `views/`, `LegacyHome`, `HomeBlocks`, `Rail`,
  `legacy.css` et leurs tests. Les catalogues anglais `en-legacy-*.ts` servaient aussi aux écrans actuels : ils sont
  gardés, renommés `en-*.ts`.
- La pipeline de base morte `documentary@1` (et son option `cardStyle`) ; `documentary@2` la remplace.
- La vidéo d'aide (31 Mo) et ses scripts ; l'aide garde les raccourcis clavier.
- Les scripts ponctuels (bancs d'essai, évaluations, captures pour docs, import du backlog, raccourcis Windows, beta sur
  un PC précis) et les hooks Claude Code personnels.
- `docs/archive`, les briefs de chantier, les notes de recherche brutes, les captures `docs/screens`, l'ancien `STATUS`
  et la `ROADMAP` ; les règles utiles sont condensées dans `docs/METHODE-REVERSE-PIPELINE.md`, `docs/TECHNOS.md`,
  `docs/ETAT.md`.
- Les chemins locaux, noms de machines et adresses e-mail personnels.
- Deux décisions internes obsolètes ; les doublons 0101 et 0111 sont renumérotés 0112 et 0113.
