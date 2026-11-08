# Les écrans (référence pour l'app web)

L'app Electron de `src/renderer/` est gardée comme **référence d'écrans** : elle montre ce que l'app web doit offrir.
Les captures (≈ 540 PNG) et la vidéo d'aide de l'ancien dépôt n'ont pas été copiées ici (trop lourdes, en partie
périmées) ; elles restent dans l'ancien dépôt privé, que Charlie garde en archive.

**Refaire les captures** : `npm run build` puis `npm run test:e2e` (Playwright, session de bureau nécessaire) écrit
les captures de chaque section et page dans `docs/screens/` (ignoré par git). Sans Electron : `npm run web:app:dev`
ouvre le même renderer dans un navigateur, en mode démo.
**Démo cliquable complète, sans aucun serveur** (onboarding, toutes les sections, le site) : `npm run demo:web`, ou
`npm run demo:web:build` → `dist-demo/` ; voir [DEMO-WEB.md](DEMO-WEB.md).

## Comment c'est organisé

- Sections et pages : `src/shared/sections.ts` (une seule source pour la barre latérale, les onglets, le routeur, ⌘K).
- Chaque zone déclare ses écrans dans `src/renderer/screens/<zone>/index.ts` ; le routage : `screens/SectionScreen.tsx`.
- Données : `src/renderer/proto/store.tsx` a deux modes. **demo** (données d'exemple `proto/data-*.ts`, pour le mode
  présentation, l'app web de démo et les tests) et **live** (vraies données par IPC, pilotes dans `proto/live/`).
- Textes en français par `t(clé)` : `src/shared/fr*.ts` (anglais dans `en*.ts`).
- Design : Tailwind v4 sur jetons CSS (sombre par défaut + clair), un accent vert calme (décision 0041), primitives de
  style shadcn et composants ElevenLabs UI vendorisés (`VENDOR.md`), icônes lucide, mascottes d'agents dessinées en
  code (décision 0057). Galerie de tous les composants : Réglages › Galerie.

## La liste

| Section › page | Écran | Code |
|---|---|---|
| Accueil | tableau de bord : vidéos en cours, validations, crédits, équipe | `screens/home/HomeScreen.tsx` |
| Validations | ce qui attend l'humain (livrables, portes de production) | `screens/home/ValidationsScreen.tsx` |
| Planning | calendrier des vidéos | `screens/planning/` |
| Production › Vue d'ensemble / Nouvelle | le Lab de production : lancer une vidéo, pipelines prêtes | `screens/production/` (`LabScreen`) |
| Production › Pipelines prêtes | les pipelines de base | `screens/production/` (`ReadyScreen`) |
| Production › Pipeline / Éditeur | éditeur de recette (briques, réglages, graphe en lecture seule, estimation) | `screens/production/` (`RecipeEditor`) |
| Production › Bibliothèque | projets (une vidéo = un projet) | `screens/production/` (`ProjectsScreen`) |
| Production › En cours | runs en cours, étapes, coûts | `screens/production/` (`EnCoursScreen`) |
| Production › Créer | **créer une pipeline** en conversation (cloner, traduire, adapter, inspirer) | `screens/production/` (`CreationScreen`) |
| Production › Agent / Style | démarrer avec l'agent de pipeline ; studio de style | `screens/production/` (`AgentStart`, `StyleStudio`) |
| Production › Ressources | technologies (briques) disponibles | `screens/production/` (`TechnologiesPanel`) |
| Production › Chaînes / Analyser / Builder | analyse de chaînes et constructeur | `screens/analysis/` |
| Production › Idées / Automatisations | idées de vidéos, automatisations | `screens/ideas/` |
| Production › Outils / Mes outils | outils | `screens/tools/` |
| Agents | l'équipe : arbre, fiches d'agent, charge, recrutement | `screens/agents/`, `screens/team/` |
| Conversations | messages avec Atlas et les agents | `screens/ConversationsScreen.tsx`, `components/chat/` |
| Cerveau | carte des idées, concurrents, niches | `screens/brain/` |
| Chaînes | chaînes, concurrents, mise en route d'une chaîne | `screens/channels/`, `screens/onboarding/` |
| Monétisation | revenus et dépenses | `screens/money/` |
| Ordinateurs | l'ordinateur d'équipe (fichiers, sessions) | `screens/computers/` |
| Réglages › Général, Compte, Équipe, Claude, Cloud, Moteur, Budgets, Chaînes, Notifications, Discord, Ordinateur, Audio, Apparence, Fonctions, Données, Avancé, Admin, À propos | préférences et comptes | `screens/settings/` |
| Réglages › Galerie | tous les composants du design system | `screens/Gallery.tsx` |
| Accueil (premier lancement) | bienvenue, connexion, mise en route | `screens/welcome/`, `screens/onboarding/` |
| Panneau Atlas (⌘J) | l'agent principal en panneau latéral | `components/agent-panel/` |
| Activité | ce que font les agents en direct | `components/orchestra/ActivityView.tsx` |

Le **site web** (landing, inscription, prix, « Mes vidéos », console fondateur `/admin`) est dans `web/`
(`npm run site:dev`).
