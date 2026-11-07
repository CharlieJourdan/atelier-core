# Architecture

Vue d'ensemble pour un nouveau développeur. Les règles du dépôt sont dans `README.md` et `CLAUDE.md` ; l'organisation
des dossiers dans `docs/STRUCTURE.md`.

## 1. Les quatre blocs

```
 ┌──────────────── Client ────────────────┐        ┌────────────── Atelier Cloud (cloud/) ──────────────┐
 │ src/renderer  React 19, écrans          │        │ Fastify + node:sqlite, lancé par Node (type         │
 │   │  window.atelier.call(method, args)  │        │ stripping, imports en .ts)                          │
 │   ▼  (un seul canal IPC typé)           │  HTTP  │ comptes · équipes · crédits · devis/réservation     │
 │ src/main  le « cerveau »                │◄──────►│ coffre à clés · adaptateurs fournisseurs (garde-fou │
 │   agents · clonage · yeux · SQLite      │  zod   │ paidCalls) · ordinateurs d'équipe · relais · kits   │
 │   │                                      │        │ e-mails · paiements · console fondateur            │
 │   ▼                                      │        └─────────────────────────────────────────────────────┘
 │ src/engine  moteur vidéo (TS + ffmpeg)   │
 │   n'importe jamais electron ni src/main  │
 └──────────────────────────────────────────┘
 src/shared : types et contrats partagés (IPC `api/`, HTTP `cloud-api.ts`, clonage `clone/`, rétro-ingénierie `reverse/`)
```

- **Le cerveau (`src/main/`)** tourne dans le processus principal d'Electron, ou **sans Electron** sur un ordinateur
  d'équipe (`src/main/headless/`, `npm run brain:headless`). `core.ts` construit tous les services ; `api/` expose une
  méthode IPC par domaine (un fichier par domaine).
- **Le moteur (`src/engine/`)** est une bibliothèque pure : il reçoit des services injectés (Cloud, stockage, hôte) et
  ne dépend ni d'Electron ni du cerveau (règle lint `atelier/engine-boundary`). Spécification : `docs/ENGINE-SPEC.md`.
- **Le Cloud (`cloud/`)** est l'autorité de l'argent (décision 0076) : le client est cru pour les pipelines, jamais pour
  les prix. Il détient les clés des fournisseurs et facture en crédits.
- **Le renderer (`src/renderer/`)** est aujourd'hui une app Electron ; il sert de **référence d'écrans** pour la future
  app web (`docs/ECRANS.md`). `npm run web:app:dev` le lance déjà dans un navigateur en mode démo.

## 2. Comment une vidéo est fabriquée (le moteur)

1. Une **pipeline** (`atelier.pipeline/1`, schéma zod `src/engine/pipeline-schema.ts`) est un graphe de **nœuds**
   (`src/engine/nodes/`, registre `productionRegistry()`) : recherche → script → voix → découpage → réalisateur →
   visuels / présentateur / motion → sous-titres → musique → rendu → contrôle qualité → miniatures → kit.
2. Elle vient d'une **recette** (`atelier.recette/1`) compilée par `src/engine/technologies/` : des **technologies**
   (briques codées, partagées par toutes les chaînes, décision 0010) avec leurs réglages ; trois couches
   brique → moteur → style (décision 0021). Les **pipelines de base** (`technologies/bases/`) ne fournissent que des
   briques et des réglages de départ.
3. Le planificateur (`scheduler.ts`, `executor.ts`) exécute les nœuds, met chaque artefact en **cache** par empreinte,
   et s'arrête aux **portes** (validations humaines).
4. Chaque nœud déclare entrées, sorties, paramètres zod, une **estimation** (crédits, temps), `run` (réel) et `fake`
   (démo, gratuit, local).
5. Le travail payant est un **job Cloud** : devis → réservation → débit (décisions 0003, 0037, 0107).
6. `render.assemble` monte avec ffmpeg ; l'**agent de revue** (`src/engine/review/`) vérifie chaque plan contre le
   texte et répare ; les **contrôles bloquants** refusent un film qui a encore une vraie erreur (décision 0102).
7. Sortie : MP4 (16:9 ou 9:16), sous-titres, miniatures, kit de publication. **Atelier ne publie jamais sur YouTube.**

Briques transverses : `sourcing/` (médias trouvés, statut légal), `motion/` (kit motion, cartes, studio three.js),
`watch/` (analyse forensique des vidéos), `presenter/` (identité), `remote-render/` (rendu ailleurs), `render/`
(montage, ménage disque).

## 3. Comment une pipeline est rétro-ingénierée (le moteur de clonage)

Code : `src/main/production/clone/`. Contrat : `src/shared/clone/` et `src/shared/reverse/pipeline.ts`.
Méthode et règles : `docs/METHODE-REVERSE-PIPELINE.md`.

```
 reverse.start(request) ─► orchestrator ─► P0 accueil ─► P1 corpus ─► P2 analyse (eyes.watchVideo, forensique)
   ─► P3 faisabilité ─► P4 définition de style (part d'une base si elle convient) ─► P5 plan de briques compilé
   ─► P6 reproduction d'un passage ─► P7 comparaison + juge aveugle ─► P8 amélioration de la cause ─► P9 exemple
   ─► P10 rapport            reverse.transform : traduire / adapter / tordre / mélanger sans ré-analyser
```

- Chaque phase a un contrôle de sortie (`exit-check.ts`) et sauve ses artefacts (`store.ts`).
- `style-gate.ts` juge d'abord une **démo gratuite** à l'aveugle ; rien de payant tant qu'elle est refusée.
- `app-producer.ts` fait produire les vrais rendus par les runs de l'app ; `fakes/` permet de tout faire tourner
  gratuitement.
- API IPC : `reverse.start | status | result | transform | list | prove` (`src/main/api/reverse.ts`) et `clone.*`.

## 4. Les agents

Référence en anglais : `docs/AGENT-RUNTIME.md`. En bref :
- **Exécution** : chaque tour d'agent est un processus Claude Code (ou Codex) CLI sur un compte de l'utilisateur, avec
  bascule entre comptes. Modèle par rôle : Haiku pour le tri, Sonnet pour le travail, Opus pour les scripts et revues.
- **File de tâches durable** (SQLite) : bail, battement de cœur, réessais, lettre morte, tâches parent/enfant.
- **Chiens de garde** : un agent muet est tué et relancé.
- **Mémoire** par agent et par chaîne, compaction, routines, objectifs permanents, niveaux de validation (décision 0017).
- **Outils** : les agents appellent les services de l'app par notre serveur MCP (`src/main/mcp/`).
- **Humain dans la boucle** : validations et questions dans la boîte de réception (Accueil › À valider) et sur Discord.
- Code : `src/main/orchestra/`, `src/main/agents/`, `src/main/mcp/`, `src/main/discord/`.

## 5. Le Cloud

- **Requêtes** : chaque requête est authentifiée AVANT la lecture du corps. Personnes : device-login ou jetons du site ;
  machines : inscription puis identifiant machine ; admins : platformAdmin.
- **Argent** : 1 crédit = 0,01 €. Chaque appel payant est un job devisé avec réservation ; un vrai job est débité de son
  vrai coût (décision 0046). Fournisseurs réels seulement si `paidCalls` est `on`, le fournisseur choisi dans
  `config.json` et sa clé dans le coffre. Paiements simulés sauf `payments: "stripe"`.
- **Ordinateurs d'équipe** : un abonnement les crée (Hetzner ; machines factices sans jeton). Leur cerveau s'inscrit et
  garde un relais sortant ; les apps l'atteignent par `/v1/team/brain/*`.
- Configuration : `cloud/config.example.json` ; clés : `docs/TECHNOS.md` ; déploiement : `docs/DEPLOY.md`.

## 6. Données

- App : SQLite `node:sqlite` (WAL), un `atelier.db` dans le dossier de données ; migrations numérotées
  `src/main/db/migrations/`.
- Cloud : sa propre base et sa propre suite de migrations `cloud/src/db/migrations/`.
- Une migration publiée n'est jamais modifiée ni renumérotée (décision 0004).
- Secrets de l'app chiffrés par `electron.safeStorage` avant la base ; jamais envoyés en clair au renderer.

## 7. Sécurité

`contextIsolation`, `sandbox`, pas de `nodeIntegration` ; le preload n'expose que `window.atelier = { call, on }` ;
chaque argument IPC passe par zod ; CSP stricte (pas de CDN) ; le Cloud ne fait confiance qu'à lui-même pour l'argent ;
`scripts/cleanroom-check.mjs` refuse tout identifiant d'un moteur tiers.

## 8. Pour l'app web

Le contrat existe déjà : `src/shared/api/` (méthodes IPC, typées) et `src/shared/cloud-api.ts` (HTTP du Cloud, zod).
Une app web peut parler au Cloud directement et au cerveau via le relais (`/v1/team/brain/*`) quand il tourne sur un
ordinateur d'équipe. Les écrans à reproduire sont listés dans `docs/ECRANS.md`.
