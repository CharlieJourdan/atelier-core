# État du projet (novembre 2026)

Court et honnête. « Prouvé » = un test, une démo ou un vrai run l'a montré. Les scores viennent de juges aveugles
(agents qui n'ont pas construit le clone) ; les coûts sont mesurés.

## Ce qui marche

- **Moteur vidéo** : format de pipeline `atelier.pipeline/1`, compilateur de recettes `atelier.recette/1`, registre
  de technologies (≈ 18 technologies en 7 étapes), cache, portes, worker, rendu ffmpeg. Démos `engine:demo`,
  `engine:dialogue-demo`, `engine:avatar-demo` passent.
- **Contrôles bloquants** : voix coupée, trou de son, image figée ou répétée, date ou chiffre non dit, carte sans
  légende → le film est refusé tant qu'il en reste un.
- **Agent de revue** à chaque rendu : chaque plan contre le texte, réparation automatique (2 tours), liste de défauts.
- **Pipelines de base** : `avatar@1` (≈ 0,5–0,7 $/min), `avatar@2` (juge aveugle 60–78 sur de vrais exemples de
  2–3 min), `documentary@2` (78/100, ≈ 0,01 $/min), `pov@1` (76/100), `story-short@1` (71,5/100), `voiceover@1`.
- **Les yeux** : `eyes.watchVideo` lit une vidéo entière en journal de plans (temps, durée, type, contenu, texte exact,
  mots, caméra), avec analyse du hook et courbe de cadence ; ≈ 17–25 s de calcul par minute de vidéo.
- **Moteur de clonage P0 → P10** de bout en bout sur fakes ; **rétro-ingénierie phase 1** (`reverse.*`) avec
  transformations sans ré-analyse.
- **Sourcing** : archives et banques libres avec statut légal et crédit ; une source gratuite ne coûte rien au client.
- **Kit motion** : transitions, caméra, punch-ins, parallaxe, cartes, graphiques, documents, carte 3D (MapLibre) ;
  aucun effet si le style n'en a pas mesuré.
- **Cloud** : comptes, équipes, crédits (devis → réservation → débit au vrai coût), coffre, console fondateur, relais.
  Moteurs réels déjà appelés : GPT Image, Veo 3.1 Lite/Fast, Grok Imagine, SeeDance, Kling, FLUX, Nano Banana,
  Seedream, HeyGen Avatar IV (MCP), ai33 (voix et clone).
- **Runtime des agents** : arbre, file durable, chiens de garde, mémoire, routines, boîte de réception ; une chaîne
  avatar produite « tout automatique » en vrai (score aveugle 66/100, ≈ 2,8 $ pour 3 min).
- **Ordinateurs d'équipe** : le gardien relance le cerveau (23 s après un kill), sauvegarde chiffrée nocturne,
  restauration, exercice de crash `npm run team-pc:drill`.
- **Sécurité** : secrets chiffrés, IPC typé et validé, CSP stricte, clean room vert.

## Ce qui est partiel

- **Ressemblance des clones** : la rétro-ingénierie mesure bien, mais le juge aveugle indépendant refuse encore
  plusieurs clones (ex. une chaîne POV dessinée : 99 % « reproductible » selon l'outil, « pas la même chaîne » selon le
  juge après 8 tours ; écarts sur le jeu, les rues en perspective, la lumière, les polices). Le juge du moteur et le
  juge indépendant ne sont pas toujours d'accord.
- **Une chaîne présentateur + motion** clonée en 5 tours : meilleur score 420/1000, arrêt sur budget.
- **Une chaîne 3D** : verdict « pas reproductible » (≈ 80 %) avec 3 alternatives — le bon comportement.
- **avatar@2** : manque une carte promo par chaîne, plusieurs cadrages du présentateur, des images moins « propres IA ».
- **Réalisateur** : n'écrit pas encore les specs de carte 3D, document, graphique, typo pour toutes les bases ; les
  réalisateurs documentaire et avatar ne choisissent pas seuls les plans du studio three.js.
- **documentary@2** : encore des archives hors sujet dans certains groupes.
- **Les yeux** : mode dense Gemini pas sur le Cloud de test ; téléchargement sans le son dans un cas ; le nombre de
  plans diffère selon la méthode.
- **Devis** : ne tiennent pas compte du cache.
- **Agents** : apprentissage par démonstration et boucle d'apprentissage pas faits ; pont Discord testé en mémoire
  seulement ; les agents demandent un abonnement Claude Code connecté.

## Ce qui n'est pas fait

- **L'app web** (le renderer actuel sert de référence, `docs/ECRANS.md`).
- **Rendu à distance en réel** : adaptateurs Scaleway, Modal, RunPod écrits mais jamais appelés ; le worker GPU
  InfiniteTalk jamais construit ; pas de route app → Cloud qui soumet les rendus par équipe.
- **Mac** : signature et mise à jour automatique (compte Apple Developer nécessaire).
- **Économie** : grille de prix et marges en pause (coûts suivis en dollars).
- **Onboarding** en pause (décision 0009).

## Limites connues

- YouTube refuse parfois les téléchargements (contrôle anti-robot) : l'analyse d'une chaîne peut rester partielle.
  L'ordre de lecture est : fichier fourni → téléchargement normal → Gemini sur le lien.
- La 3D détaillée (textures, personnages) est hors de portée ; Blender n'est pas branché.
- Les vraies personnes filmées demandent une entrée humaine (rushes) ; le visage ou la voix d'un tiers n'est jamais
  cloné.
- `faster-whisper` doit être installé à part (`ATELIER_WHISPER_PYTHON`) pour le minutage local des mots.
- Les tests sous forte charge peuvent dépasser des délais de chargement : relancer le fichier seul.
- Quelques fichiers dépassent 600 lignes (`src/shared/cloud-api.ts`, `src/main/core.ts`, deux nœuds du réalisateur,
  `src/main/production/runs/service.ts`, deux composants vendorisés, `proto/data-brain.ts`).

## Repères techniques

- Dernières migrations : app `041` (`041_video_orders.ts`), Cloud `020` (`020_free_quotes.ts`).
- `npm test` : environ 400 fichiers de tests, 4 400 tests (totaux exacts dans le rapport de passation).
