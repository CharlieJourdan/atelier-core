# Atelier

Atelier est une **équipe d'agents IA** et un **moteur vidéo** qui savent faire une chose difficile : regarder une chaîne
YouTube et **retrouver la chaîne de production (la « pipeline ») qui fabrique ses vidéos** — quelles briques, quels
réglages, ce qu'un humain doit fournir, ce qui est impossible, combien ça coûte et combien de temps ça prend à la minute.

Ce dépôt contient le **backend** (moteur, moteur de clonage, Cloud, runtime des agents, pipelines de base) et l'**app
Electron actuelle**, gardée comme **référence d'écrans** pour la future app web.

> Le code et les commentaires sont en anglais ; la documentation est en français.

## L'objectif, en une phrase

**Rétro-ingénierie de la pipeline de production d'une chaîne**, puis la **copier**, la **traduire**, l'**adapter**,
la **tordre** (changer un axe) ou la **mélanger** avec d'autres — et produire avec. On copie une *pipeline*, jamais une
vidéo. Plus tard : des pipelines prêtes à l'emploi. Ordre des priorités : la qualité d'abord, puis le coût, puis le temps.

Les règles qui rendent une copie bonne sont dans [`docs/METHODE-REVERSE-PIPELINE.md`](docs/METHODE-REVERSE-PIPELINE.md).
C'est le document le plus important du dépôt.

## Les deux fonctions principales

1. **L'équipe d'agents** — un agent principal (Atlas), un responsable par chaîne et des spécialistes (recherche, script,
   réalisation, montage, packaging, analyse des concurrents, contrôle qualité). Ils tournent sur l'abonnement Claude
   Code (ou Codex) de l'utilisateur, avec file de tâches durable, chiens de garde, mémoire, routines et validations
   humaines.
2. **Le bac à sable de production** — des **pipelines** faites de **briques** (voix, présentateur, images trouvées,
   images générées, motion design, montage, sous-titres, musique, revue…), et la **copie de pipeline** : on colle une
   chaîne, le moteur de clonage l'analyse et sort sa pipeline.

## Carte des fonctions (maturité honnête)

| Fonction | Maturité | Où |
|---|---|---|
| Moteur vidéo : nœuds, format de pipeline, compilateur de recettes, cache, rendu ffmpeg | **solide** | `src/engine/` (`nodes/`, `technologies/`, `render/`) |
| Contrôles bloquants (voix coupée, trou de son, image figée, date non dite, carte sans légende) | **solide** | `src/engine/review/`, `src/engine/nodes/qc-check.ts` |
| Pipelines de base : `avatar@1`, `avatar@2`, `documentary@2`, `pov@1`, `story-short@1`, `voiceover@1` | **solide** (qualité variable, voir `docs/ETAT.md`) | `src/engine/technologies/bases/` |
| Moteur de clonage P0 → P10 et rétro-ingénierie (`reverse.*`) | **expérimental** | `src/main/production/clone/`, `clone/reverse/`, `src/shared/reverse/`, `src/main/api/reverse.ts` |
| Les « yeux » : lecture d'une vidéo entière plan par plan, analyse de chaîne | **partiel** | `src/main/eyes/`, `src/engine/watch/`, `src/main/analysis/`, `src/main/production/clone/analysis/` |
| Agent de style (propose et règle un style) | **partiel** | `src/main/production/style-agent/` |
| Kit motion (transitions, caméra, cartes, graphiques, cartes 3D) | **partiel** | `src/engine/motion/`, nœud `edit.fx@1` |
| Studio motion three.js (scènes 3D dans une carte) | **expérimental** | `src/engine/motion/studio*.ts`, `src/engine/formats/studio.ts` |
| Recherche de médias (archives libres, banques, extraits) | **solide** | `src/engine/sourcing/` |
| Agent de revue du montage (plan par plan contre le texte) | **solide** | `src/engine/review/`, `src/main/production/clone/style-gate.ts` |
| Cloud : comptes, équipes, crédits, devis → réservation → débit, coffre à clés, adaptateurs fournisseurs | **solide** | `cloud/src/` |
| Runtime des agents (arbre, file, chiens de garde, mémoire, routines, boîte de réception) | **partiel** (prouvé sur fakes et un vrai cas) | `src/main/orchestra/`, `src/main/agents/`, `src/main/mcp/` |
| Pont Discord (téléphone) | **partiel** (testé en mémoire seulement) | `src/main/discord/` |
| Ordinateurs d'équipe (cerveau sans Electron, gardien, sauvegardes) | **partiel** | `src/main/headless/`, `cloud/src/machines/` |
| Rendu à distance (Scaleway, Modal, RunPod) | **expérimental** (jamais appelé en réel) | `src/engine/remote-render/`, `cloud/src/render/`, `deploy/render-worker/` |
| Sécurité (secrets chiffrés, IPC typé, CSP stricte, clean room) | **solide** | `src/main/secrets.ts`, `src/main/electron/`, `scripts/cleanroom-check.mjs` |
| App Electron (écrans) | **référence d'écrans** | `src/renderer/` — liste dans [`docs/ECRANS.md`](docs/ECRANS.md) |
| Site web (landing, inscription, prix, console fondateur) | **partiel** | `web/` |

## L'architecture en un schéma

```
             ┌──────────────────────────── App (Electron aujourd'hui, web demain) ───────────────────────────┐
             │  src/renderer  (React, écrans)  ──IPC typé « atelier:call »──►  src/main  (le « cerveau »)       │
             └──────────────────────────────────────────────────────────────────────┬────────────────────────┘
                                                                                    │
     src/main : agents (orchestra, mcp, discord) · moteur de clonage (production/clone) · yeux (eyes) · SQLite
                       │                                      │
                       ▼                                      ▼
         src/engine  (moteur vidéo, TypeScript + ffmpeg,      Atelier Cloud  cloud/  (Fastify + SQLite)
         n'importe jamais electron ni src/main)  ──jobs──►   crédits · devis · coffre à clés · adaptateurs
                                                              fournisseurs (voix, images, clips, avatars…)
                                                              derrière le garde-fou « paidCalls »
```

Détails : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Organisation des dossiers : [`docs/STRUCTURE.md`](docs/STRUCTURE.md).

## Installer et lancer

Prérequis : **Node ≥ 22.12**, **ffmpeg** dans le PATH (pour les démos moteur et une partie des tests).
Optionnel : Python avec `faster-whisper` (minutage des mots, variable `ATELIER_WHISPER_PYTHON`), Chromium de
Playwright (rendu des cartes motion).

```bash
npm install
npm run typecheck        # 5 projets TypeScript (node, web, cloud, engine, site)
npm run lint
npm test                 # tests unitaires vitest (y compris cloud/tests et le contrôle clean room)

npm run cloud:dev        # Atelier Cloud sur 127.0.0.1:8787, tout en fakes : aucune clé, aucun coût
npm run smoke:cloud      # test de bout en bout gratuit du Cloud

npm run engine:demo      # démo du moteur (ffmpeg requis) ; code de sortie 0 = réussi
npm run engine:dialogue-demo | engine:avatar-demo | engine:story-demo | engine:motion-demo
npm run orchestra:demo   # invariants du runtime des agents

npm run dev              # l'app Electron (référence d'écrans) ; mettre ATELIER_USER_DATA sur un dossier de dev
npm run web:app:dev      # le même renderer dans un navigateur, en mode démo
npm run demo:web         # démo cliquable complète, sans serveur (docs/DEMO-WEB.md) ; demo:web:build → dist-demo/
```

Les tests n'appellent **jamais** un fournisseur payant ni le réseau réel : tout passe par des fakes.

## Les clés

Il n'y a **aucune clé** dans ce dépôt, même gratuite. Charlie les transmet en privé.

- [`.env.example`](.env.example) : toutes les variables d'environnement lues par le code (chemins, options, outils).
- [`cloud/config.example.json`](cloud/config.example.json) : la configuration du Cloud (fournisseurs choisis, garde-fous).
- Les clés des fournisseurs vont dans le **coffre chiffré du Cloud** : `npm run cloud -- vault set NOM` (saisie sans
  écho). La liste des noms et ce que chacun débloque : [`docs/TECHNOS.md`](docs/TECHNOS.md).

## Ce qui est fait, pas fait, et les limites connues

Résumé honnête dans [`docs/ETAT.md`](docs/ETAT.md). En bref :

- **Fait** : le moteur et ses briques, six pipelines de base, le Cloud complet en fakes et une quinzaine de moteurs
  réels déjà appelés, la lecture de vidéos entières, le moteur de clonage de bout en bout sur fakes, la rétro-ingénierie
  (phase 1) avec transformations (traduire / adapter / tordre / mélanger).
- **Pas fait** : l'app web (le renderer actuel est une référence), le rendu à distance en réel, la boucle
  d'apprentissage des agents, le pont Discord réel.
- **Limites** : le juge aveugle « même chaîne ? » refuse encore plusieurs clones ; la 3D détaillée et les vraies
  personnes filmées ne se reproduisent pas sans entrée humaine ; YouTube bloque parfois les téléchargements.

## Par où commencer

1. Ce README, puis [`docs/METHODE-REVERSE-PIPELINE.md`](docs/METHODE-REVERSE-PIPELINE.md) (le *pourquoi* et les règles).
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) et [`docs/STRUCTURE.md`](docs/STRUCTURE.md) (le *comment*).
3. [`docs/ETAT.md`](docs/ETAT.md) (où on en est) et [`docs/DECISIONS-CLES.md`](docs/DECISIONS-CLES.md) (les choix qui comptent).
4. Lancer `npm test`, `npm run cloud:dev` et `npm run engine:demo`.
5. Lire `src/shared/reverse/pipeline.ts` (le contrat de la rétro-ingénierie) puis `src/main/production/clone/engine.ts`.

Deux façons de continuer, toutes les deux possibles :
- **Reprendre** ce code : garder le moteur, le Cloud et le moteur de clonage, et écrire l'app web contre l'API
  (`src/shared/api/`, `src/shared/cloud-api.ts`) en s'inspirant des écrans de `src/renderer/`.
- **Repartir de zéro** : la méthode, les technologies, les décisions et l'état sont décrits pour qu'on puisse
  reconstruire sans lire tout le code.

## Règles du dépôt

- **Clean room** (décision 0001) : ne jamais copier le code, les noms, les prompts ou les fichiers d'un moteur tiers ou
  d'une app commerciale. `node scripts/cleanroom-check.mjs` doit passer (il tourne aussi dans `npm test`).
- **Jamais d'écriture sur YouTube** (pas d'upload, pas de commentaire). La lecture publique est permise.
- **Rien de payant sans accord** : `paidCalls` est `off` par défaut ; les tests utilisent des fakes.
- **Aucun secret** dans git, les logs ou les fixtures.
- Ne jamais affaiblir un test pour le faire passer ; corriger le code.
- Modules courts (< 600 lignes) ; migrations SQLite numérotées et jamais modifiées une fois publiées.
