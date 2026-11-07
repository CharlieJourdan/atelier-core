# Méthode : rétro-ingénierie d'une pipeline de production

Ce document rassemble **toutes les règles qui rendent une copie bonne**. Il vaut pour un humain comme pour un agent, et
pour chaque chaîne : il ne contient aucune réponse sur une chaîne particulière, seulement la façon de les trouver.
Ce sont des exigences précises, pas des limites rigides : on adapte les chiffres à chaque cas, jamais la rigueur.

Code concerné : `src/main/production/clone/` (phases P0–P10), `clone/reverse/` et `src/shared/reverse/pipeline.ts`
(contrat), `src/main/eyes/` et `src/engine/watch/` (lecture des vidéos), `src/engine/review/` (revue et contrôles).

---

## 1. Le principe

- **On copie une PIPELINE, pas une vidéo.** Le produit est la chaîne de fabrication : les briques branchées, chaque
  réglage, ce qu'un humain fournit, ce qui est impossible (et pourquoi), le coût et le temps mesurés par minute.
  Ensuite l'utilisateur peut la **copier**, la **traduire**, l'**adapter**, la **tordre** (changer un axe), la
  **mélanger** avec d'autres, et produire.
- **Chaque chaîne est différente.** Beaucoup n'ont ni personne ni avatar (animation pure, motion design seul, archives
  seules, texte sur gameplay…). On ne suppose rien : l'analyse dit de quoi la chaîne est faite.
- **La pipeline de base ne donne que des briques ; la référence donne le style.** Le look, les mises en page, le
  motion, le rythme, l'identité du présentateur, son nombre de plans et sa présence partie par partie viennent tous de
  l'analyse mesurée. Une valeur par défaut seulement là où rien n'a été mesuré. (Échec historique : le moteur prenait
  la base la plus proche et gardait son look ; une chaîne avec un vrai présentateur filmé est sortie en vidéo avatar.)
- **Partir d'une base quand elle convient** (décision 0112) : pour une chaîne du même type qu'une base existante, P4/P5
  partent de cette base, mais **chaque réglage est vérifié** contre les mesures ; ce qui diffère est remplacé. On ne
  garde jamais un réglage de base sans preuve qu'il correspond. On construit de zéro seulement si aucune base ne va.
- **Si aucune brique ne convient, on la construit** dans le moteur, on la teste, et elle sert à tous les clones
  suivants. Un clone n'est jamais forcé dans le gabarit le plus proche.
- **Tout ce qu'on apprend va dans le MOTEUR** (analyse, briques, champs de définition, règles, prompts), pour que la
  prochaine chaîne inconnue marche du premier coup. Polir une pipeline à la main ne compte pas.
- **Qualité d'abord, puis coût, puis temps.**

## 2. Les règles fixes (méthode)

1. **Ultra méticuleux.** On fait comme si la chaîne était celle de l'utilisateur et qu'il voulait un copier-coller.
   « À peu près » est un échec.
2. **Pousser au maximum.** Mesurer, construire, rendre, comparer côte à côte, corriger, recommencer. On s'arrête quand
   un tour n'améliore plus rien, et on dit pourquoi.
3. **Production la moins chère et la plus rapide** qui garde la ressemblance. Mesurer $/minute et temps de rendu à
   chaque tour. Promesse (pas une loi) : la plupart des vidéos sous ≈ 1 $ la minute pour l'utilisateur.
4. **Ressemblance honnête**, notée par axe sur des images appariées, jamais de mémoire.
5. **Fidèle** à ce que l'utilisateur a demandé et accepté.
6. **Aucun blocage** : on va jusqu'au bout comme un utilisateur ; tout blocage est corrigé ou signalé.
7. **Clean room** : on étudie des méthodes publiques et on les ré-implémente à notre façon ; on ne copie jamais le
   code, les noms ou les fichiers d'un produit tiers. Les phrases récurrentes d'une chaîne sont **décrites**, jamais
   recopiées.

## 3. Le processus, phase par phase (chaque phase a un contrôle de sortie)

**P0 — Accueil (conversation courte).** Ce que veut l'utilisateur ; le budget de test ; ses entrées humaines possibles.
Sortie : un brief écrit. Voir §11 pour les questions.

**P1 — Corpus.** Une seule vidéo demandée → cette vidéo. Une chaîne → les dernières vidéos **et** les plus performantes,
assez pour voir les invariants et les variations (souvent 5–10 ; plus si les styles varient). Si une seule vidéo est
donnée, dire qu'on aurait pu étudier plus de la chaîne. Sortie : la liste, avec pourquoi chaque vidéo est choisie.

**P2 — Analyse complète de chaque vidéo** (`eyes.watchVideo`, décision 0085). Toujours la vidéo **entière**, jamais
« les 5 premières minutes ». Si une partie ne peut pas être lue, le dire : c'est un blocage, pas un détail. Par vidéo :
- **journal des plans** : chaque plan avec début, durée, type, ce qui est montré, texte exact à l'écran, mots dits
  pendant le plan, s'il les illustre, mouvement de caméra ; des images par plan + des images denses (toutes les 0,5 s)
  sur le hook et à chaque changement de partie ;
- **présentateur** : vraie personne filmée, avatar ou aucun ; descripteurs (âge, genre, visage, cheveux, tenue, décor,
  lumière) ; nombre de plans / angles ; mise en page par plan (plein, demi gauche/droite, incrustation où et de quelle
  taille, absent) ; part et motif par partie ; comment il entre et sort ;
- **voix** : réelle ou synthétique, timbre, débit (mots/min mesurés sur les minutages), pauses, énergie, traitement ;
- **motion design** : chaque type d'élément (cartes, graphiques, compteurs, frises, documents surlignés, typo
  animée, cartons, bandeaux), durée, easing, palette, polices, texture, comment et quand il tombe sur son mot ;
- **montage** : types de coupe, distribution des durées de plan et sa **courbe** dans la vidéo, transitions,
  parts b-roll / photos / footage et leur origine (§5), traitement de la couleur ;
- **son** : musique (genre, niveau sous la voix, ducking, changements), effets (lesquels, sur quoi), silences, loudness ;
- **script** : structure, motif du hook, promesse, payoff, chapitres, appel à l'action, longueur des phrases, ton ;
- **format et packaging** : long/court, ratio, résolution, durées ; motifs de titres et de miniatures.

Puis une **synthèse inter-vidéos** : ce qui est constant (le style) et ce qui varie (selon le sujet), avec fréquences.
Sortie : fichiers d'analyse sauvés ; chaque chiffre mesuré, avec sa preuve (images, timestamps).

**P3 — Carte de faisabilité.** Pour chaque élément du style : la brique qui le fait, ou « entrée humaine » (un slot
d'import), ou « impossible » (technologie manquante, avec le coût pour la construire ou l'importer). La part
reproductible se calcule sur le **temps d'écran MESURÉ** de chaque élément, pas sur une impression. Verdict (§9).

**P4 — Définition de style.** La définition propre à la chaîne, aussi riche qu'une définition écrite à la main par un
expert, mais mesurée : intentions et motifs de script, voix, identité du présentateur et **toutes ses configurations**
(portrait + le nombre d'angles mesuré) avec sa courbe de mise en page par partie, grammaire du motion, grammaire du
montage, règles de sourcing (trouvé ou fabriqué), son, sous-titres, packaging, cibles de coût.
Rien ne doit venir des valeurs par défaut d'une base sans que l'analyse ait mesuré la même chose.

**P5 — Construire la pipeline** à partir des briques pour exécuter cette définition, avec les **slots d'entrée humaine
remplis par des doublures** pour qu'elle tourne de bout en bout tout de suite (§8).

**P6 — Reproduire un vrai passage** de référence (60–180 s) : notre propre script sur le même sujet et la même
structure, produit par la pipeline sur de vrais moteurs, dans le budget.

**P7 — Comparer, honnêtement.** Images appariées côte à côte aux mêmes moments ; courbes mesurées comparées (durées de
plan, mises en page par partie, présence du présentateur, densité du motion, palette, débit, loudness) ; la liste de
défauts de l'agent de revue (décision 0086) ; un **juge aveugle** qui voit la référence et notre rendu mélangés et
répond « **même chaîne ?** », et note chaque axe avec sa liste de défauts.

**P8 — Améliorer jusqu'au maximum.** Corriger la **CAUSE** (un champ de définition, une brique, une règle), re-rendre
seulement ce qui a changé (cache), recomparer. Arrêt quand deux tours n'améliorent plus aucun axe ou que le budget de
test est dépensé. Puis des tours de coût : les moteurs et réglages les moins chers qui gardent chaque axe à son niveau.
Noter $/min et temps de fabrication/min à chaque tour.

**P9 — Exemple complet.** Une vraie vidéo de plusieurs minutes (à la vraie longueur du format : une vidéo longue
entière, ou la durée normale d'un short — 17 secondes ne suffisent pas pour juger rythme, hook et fin) ; passage de
l'agent de revue ; le juge aveugle doit dire « même chaîne » avant que quoi que ce soit soit montré.

**P10 — Rapport à l'utilisateur** (simple, illustré) : le verdict ; la vidéo exemple ; les images côte à côte ; ce qu'il
doit fournir et quelles doublures le remplacent en attendant ; coût mesuré par minute et temps de fabrication ;
quelques propositions (§12), chacune avec aperçu, coût, temps et rendu.

## 4. Ce qu'il faut trouver (des questions, pas des réponses)

Chaque réponse vient de preuves (images, sous-titres, audio), et la preuve est écrite à côté.

- **Structure dans le temps.** Découper la vidéo en parties (hook, mise en place, sections, promo au milieu, fin, appel
  à l'action). Pour chaque partie : distribution des durées de plan, part de chaque origine d'image, part et mise en
  page du présentateur, texte à l'écran, intensité du motion, densité musique et effets, débit de la voix. **Chercher la
  courbe, pas la moyenne** : ce qui est plus dense au début, ce qui domine à la fin, ce qui se répète par section.
- **Montage.** Coupes franches, fondus, whip, raccords, J/L cuts ; où tombent les coupes (sur quel mot, sur le temps, sur
  une respiration) ; mouvements de caméra (push-in, pan, parallaxe, tremblé), punch-ins, rampes de vitesse,
  incrustations, cadres et bordures, transitions par section ; durée et easing de chaque mouvement.
- **Motion design.** Cartes (2D/3D, inclinaison, relief, extrusion, lumière, légendes, trajet de caméra), graphiques et
  compteurs, frises, documents et surlignages, typo animée, cartons et bandeaux. Timing au mot, easing, flou de
  mouvement, style (palette, polices, textures). Mesurer image par image là où ça compte.
- **Texte et sous-titres.** Police, taille, graisse, couleur, contour, ombre, position, mots par sous-titre, timing sur
  la voix, animation d'entrée et de sortie, mots en emphase.
- **Variété.** Combien de façons distinctes de montrer une image (plein cadre, centrée, carré sur le côté, plusieurs
  éléments, document zoomé avec soulignement, exceptions de couleur), à quelle fréquence chacune revient, comment les
  mises en page et les fonds changent entre parties. Une référence répète rarement trois fois de suite le même motif ;
  le clone non plus. Quelques secondes mesurées puis bouclées donnent un clone qui se répète.

## 5. D'où vient chaque image, et comment elle est traitée

Pour **chaque plan**, classer l'origine :
- **filmé** : présentateur réel, rushes de l'utilisateur, footage d'une autre vidéo ;
- **trouvé** : photo d'archive, film d'archive, banque d'images, capture d'écran ;
- **généré** : image IA, vidéo IA ;
- **dessiné** : motion design codé, dessins (POV), aplats de couleur (comptés comme dessin, pas comme génération) ;
- **3D** : rendu de carte, de scène, d'objets ;
- **fourni** par l'utilisateur.

Comment le savoir : grain, compression, filigranes, anachronismes, cohérence des visages, rendu du texte, mouvement.
Une classe d'origine est-elle totalement absente ? L'image est-elle **traitée** (désaturée, étalonnée, recadrée,
dégradée) ? De quelle bibliothèque, archive ou chaîne vient-elle, et peut-on retrouver la même ?

Règles :
- **Ce qui est trouvé reste trouvé ; on ne génère que là où la référence génère.** Une image générée là où la référence
  met une archive est un échec de ressemblance. L'agent doit remarquer seul qu'une référence n'a aucune image générée.
- Un documentaire d'archives choisit ses archives sur planche-contact et peut adapter le script aux images qui existent.
- Quand on clone une vidéo précise, ses médias sont déjà choisis : il faut les retrouver (ou les plus proches) dans les
  mêmes sources.
- Le choix des médias est un travail d'agent : il regarde ce qui est réellement disponible (archives, banques, footage,
  médias de l'utilisateur) et prend le meilleur pour les mots ; la génération ne comble que de vrais trous.
- Garder les proportions avatar / vidéo / image de la référence (moyenne sur la vidéo, réglable par l'utilisateur, avec
  une courbe par partie).
- Une source qui ne nous coûte rien ne coûte rien à l'utilisateur (décision 0105).
- Pas d'image identique deux fois à moins de ~20 s (décision 0049).

## 6. Rythme, structure et timing

- **Copier la cadence, le rythme et la structure, pas seulement le look.** Un clone qui a le style mais pas le montage
  n'est pas une réussite.
- **Répartition dans le temps** : mesurée par partie et par dixième de vidéo. Exemple typique d'une chaîne avatar :
  plus de présentateur dans le hook, plus d'images vers la fin. Le présentateur n'est pas toujours en demi-écran ;
  parfois en grand. Le zoom d'ouverture et la cadence sont mesurés, pas devinés.
- **Le hook est réactif** : coupes rapides, l'image clé sur les premiers mots, jamais 6 s d'animation avant que quelque
  chose se passe. Étudier le hook à part (30–60 premières secondes de plusieurs vidéos).
- **Chaque plan illustre les mots dits dessous, à l'heure** (décision 0052). Couper sur le mot. Un plan dont le sujet
  n'est pas ce qui est dit (armée au hasard, gens dans la neige, portrait recadré sans rapport) est un défaut. Quand
  aucune archive ne colle, expliquer avec du motion dans le style de la vidéo (une ligne le long des Alpes pour « une
  forteresse », une légende sur la carte qui dit qui possède quoi) plutôt qu'une image vague.
- **Pas de temps mort** : pas d'image tenue ~5 s ou plus sans rien qui bouge, pas de motion qui démarre puis se fige,
  pas de pause où rien ne bouge.
- **Dates, chiffres et mots à l'écran dans la langue de la vidéo**, et sur le mot auquel ils appartiennent ; un « ×20 »
  dit à voix haute apparaît sur son mot ; un trajet se dessine progressivement.
- **Le motion respecte l'époque et le style** (palette, texture) : du motion générique ou « futuriste » sur un
  documentaire d'époque est un défaut. Les zooms sont doux et utiles.
- **Shorts** : la cadence est tout ; lire image par image (toutes les 1–2 images autour des coupes, cartons, sous-titres).
- **Seulement ce que la référence a** : pas d'effets sonores, sous-titres, cadres ou bordures qu'elle n'utilise pas.
  Ce qu'elle n'a pas devient une **proposition**, offerte à part, jamais le défaut d'un clone fidèle.
- **Musique** : celle qui suit la référence, ou aucune. Jamais une piste au hasard ou irritante. Bibliothèques gratuites
  ou musique fournie par l'utilisateur. Les effets sonores sont une option, seulement si la référence en a.
- **Réfléchir, pas seulement copier** : le réalisateur est un agent ; il copie le style ET ajoute l'explication créative
  dont le moment a besoin (légendes, explication en deux parties, annotation de carte), dans ce style.

## 7. Vraies erreurs vs ressemblance

Deux mécanismes distincts (décision 0102) :

- **Les vraies erreurs sont des contrôles BLOQUANTS, écrits en code** : voix coupée, trou de son, image figée ou
  répétée, date ou chiffre non dit, carte sans légende, sous-titres décalés, motion qui ne finit pas. Un film qui en a
  encore un est refusé (`src/engine/review/`, `qc.check`, `render.assemble` répare sur son propre plan).
- **La ressemblance est une boucle d'amélioration** : comparer → noter par axe → corriger la cause → recommencer. Elle ne
  bloque pas, elle s'améliore.
- Des images similaires avertissent mais n'arrêtent jamais un run (décision 0053).
- **L'agent relit son propre rendu image par image avant de noter** : textes qui se chevauchent ou sont coupés,
  étiquettes superposées, zoom avant puis arrière sur la même image, image tenue trop longtemps, sous-titres qui
  dérivent, accrocs aux coupes. Chaque défaut est corrigé avant le tour suivant.

## 8. Entrées humaines, doublures et ce qui est impossible

- **Classer chaque humain à l'écran** (vrai présentateur ou avatar) **et chaque voix** (réelle ou synthétique), et le
  dire clairement comme une conclusion (« il y a une vraie personne ici »).
- La pipeline déclare des **slots d'import** (vraie voix, rushes, scripts, idées, clips, musique, produit, personnage) et
  les remplit avec des **doublures** (voix synthétique, avatar provisoire, clips de banque, photo trouvée) pour que chaque
  test automatique tourne de bout en bout. À la production, l'agent attend la vraie entrée à un endroit de dépôt évident ;
  plusieurs scripts ou idées peuvent être importés d'avance.
- **Un vrai présentateur filmé** : soit l'utilisateur importe ses rushes (reproduction à 100 % ou à un pourcentage dit),
  soit la pipeline attend une entrée humaine à chaque production. Signaler les tâches humaines dès l'accueil, même si un
  visage imaginé sert dans l'exemple.
- **Le visage ou la voix d'un tiers n'est JAMAIS cloné.** Pour la chaîne de l'utilisateur : ses propres clones (avatar,
  voix), avec consentement (décision 0025). Pour toute autre chaîne : une **doublure ressemblante du même type** (âge,
  genre, tenue, décor, cadrage) avec ses angles, **clairement marquée comme provisoire**, dans un slot d'import.
- **Footage qu'on ne peut pas obtenir** légalement ou techniquement (gameplay, interviews, clips sous licence) :
  proposer que l'utilisateur importe le sien, ou une étape humaine, et le dire dès le début.
- **Dire tôt ce qui ne peut pas être fait** (décision 0083) : clips musicaux, personnes filmées sans import, 3D avancée…
  Arrêter **avant de dépenser**, avec une alerte nette (« Pas reproductible »), ce qu'on peut quand même faire (voix,
  script, montage, miniature) et des alternatives **fidèles à CETTE chaîne** (son sujet, son ton, sa structure, sa
  palette) — jamais le gabarit d'une autre chaîne. Exemple : un podcast ne se clone pas tel quel, mais on peut prendre
  l'audio ou le script et le ré-illustrer, l'animer et le monter ; une chaîne musicale : non, avec la raison.
- **Proposer des humains quand il le faut** : la tête du présentateur filmée par l'utilisateur, des parties du montage
  faites par une personne, avec la façon dont la pipeline les intègre.

## 9. Verdicts et scores qui veulent dire quelque chose

- Vocabulaire du verdict : **reproductible** (~100 %) ; **reproductible avec entrées humaines** ; **partiellement**
  (dire ce qui manque et pourquoi, et la part en %) ; **semble reproductible mais ne l'est pas** ; **pas reproductible**
  (arrêt net).
- Pour un cas reproductible en motion pur, 20–70 % veut dire « pas assez poussé » : la cible est ~100 %.
- **Chaque axe est noté à partir d'une liste écrite de différences et de défauts** trouvés sur images appariées, avec le
  poids de chacun (quoi, où, timestamp, correction). Axes : pertinence de l'illustration, timing, hook, structure,
  motion, sous-titres, musique, voix, cadence, mise en page, angles, coût, temps.
- **Un score sans sa liste de défauts n'est pas rapporté.** Des scores qui se regroupent autour d'une même valeur quel
  que soit le résultat ne veulent rien dire.
- **Un second agent qui n'a pas construit le clone le re-note à l'aveugle** et répond « même chaîne ? ». Non → corriger
  et refaire. On ne montre jamais un exemple qui ne ressemble pas.
- Un score élevé sur la mauvaise chose est un échec : un clone peut avoir le style et être mal monté.
- Les variantes doivent montrer quelle partie change quel score (trois variantes « fidèle / éco / premium » sans
  différence visible ont été refusées).
- **Une comparaison non sauvée n'a pas eu lieu.** Chaque tour garde ses preuves : images côte à côte, courbes comparées,
  liste de défauts, réponse du juge, coût et temps.
- Dire franchement quand une chaîne de référence est faible ; si les vidéos varient beaucoup, proposer de cloner la
  plus performante.
- Rien n'est annoncé tant qu'une vidéo produite n'existe pas ; le coût et le temps d'un exemple sont **mesurés**.

## 10. Coût et temps (après la qualité)

- Chaque pipeline affiche le coût minimum, maximum et moyen par minute finie, et le temps de production, par lieu de
  rendu. Les estimations sont vérifiées par des tests ; les prix devisés sont respectés (le Cloud réserve le prix du
  moteur choisi, décision 0107).
- Ordres de grandeur mesurés : un documentaire d'archives ne coûte presque rien en API (≈ 0,01 $/min) ; une minute
  d'avatar vise ≈ 0,5–0,6 $.
- Demander le budget de test au départ, avec un maximum. Les tests ne dépensent qu'avec l'accord de l'utilisateur et
  sous un plafond ; la boucle s'arrête au plafond.
- Utiliser l'abonnement Claude de l'utilisateur le moins possible (modèle moins cher, effort bas, ne jamais vider son
  quota). Une pipeline 100 % code ne doit rien consommer à la production.
- Le rendu ne tourne jamais sur l'ordinateur de l'utilisateur (décision 0012).
- La création et les tests prennent des heures : le dire dès le départ ; prévenir l'utilisateur quand c'est fini ou bloqué.
- Une fois une pipeline au point, elle devient une base solide : prix stables, aucun rendu arrêté à mi-chemin, les
  agents réessaient. La base est rigide ; les règles créatives autour ne le sont pas.

## 11. Poser les bonnes questions à l'utilisateur

Toutes les questions en une fois, dans une conversation courte, puis l'agent travaille. Pas un mur de formulaires.
- Point d'entrée : sa propre chaîne (copie identique) / copier la chaîne de quelqu'un / copier seulement cette vidéo /
  traduire / s'inspirer par axe / mélanger plusieurs chaînes / retravailler une pipeline / une vidéo test isolée.
- Si la chaîne a plusieurs styles : lequel. Copier le style d'une vidéo ou de la chaîne.
- Langue(s) ; long, court ou les deux.
- Qui écrit les scripts et les idées, et s'il les importe.
- Un humain apparaît-il, et comment entre-t-il ; quelles entrées il peut fournir (son visage, sa voix, ses rushes, sa
  musique, ses clips).
- Quelles étapes il valide lui-même et lesquelles tournent seules.
- Objectifs (ex. 3 vidéos par semaine), budget de production et **budget de test plafonné**.
- Pour une niche similaire : les éléments de différenciation. Pour une création de zéro : l'inspiration par axe.
- Effets sonores : oui ou non. Comptes ou clés nécessaires (demander au moindre coût).
- Demander avant de dépenser et en cas de doute ; répondre à la question posée plutôt que d'avancer sur sa propre
  interprétation.

## 12. Traduire, adapter, tordre, mélanger, proposer

- **Traduire** : même montage, script traduit, voix de la langue cible (jamais celle d'un tiers) ; vérifier d'abord si
  des versions traduites existent déjà. Des différenciateurs sont permis (décision 0064).
- **Adapter** : même pipeline, autre sujet ou autre public ; les réglages mesurés restent.
- **Tordre** : changer un axe (motion, montage, voix, part d'archives…) en gardant le reste.
- **Mélanger** : plusieurs chaînes servent de supports (sujet et structure peuvent venir de supports différents), avec
  des propositions de combinaison.
- Ces transformations repartent de la pipeline rétro-ingénierée **sans refaire l'analyse** (`reverse.transform`).
- Une **alternative** garde le sujet, le ton, la structure et l'univers visuel de la référence et ne remplace que ce qui
  est impossible ; elle n'emprunte jamais le look d'une autre chaîne.
- Les pipelines sont indépendantes des chaînes : une pipeline peut servir plusieurs chaînes, une chaîne peut en avoir
  plusieurs ; elles s'exportent en fichier.
- **Proposer avec initiative**, après le clone fidèle : une courte liste d'améliorations ou de variantes concrètes
  (plusieurs angles, plus de motion, archives, sous-titres, autre voix, musique ou clips de l'utilisateur, carton
  d'ouverture, placement produit, zooms et soulignements sur documents…), chacune avec un aperçu, son effet sur le coût,
  le temps et le rendu. Moins de propositions quand on clone la chaîne de l'utilisateur ; plus quand on crée ou mélange.
  Rester sensé : pas de vidéo IA sur une chaîne documentaire qui n'en a pas.

## 13. Choisir les technologies

- Avant de construire, regarder ce qui existe : les briques et moteurs d'Atelier (`docs/TECHNOS.md`), puis les outils et
  API publics éprouvés. Intégrer avant de développer ; construire seulement ce que rien ne fournit.
- Pour chaque technologie : coût par minute, temps par minute, qualité, licence, et comment elle se branche aux autres.
- L'agent peut importer et tester des technologies seul, comparer, proposer, et demander un compte ou une clé seulement
  quand il le faut.

## 14. Livrables d'une rétro-ingénierie

L'analyse avec ses preuves ; la part reproductible ; la pipeline (recette + briques) ; la vidéo et la planche-contact de
chaque tour avec ses scores par axe et leurs défauts ; $/minute et temps de rendu ; la liste des manques technologiques
(importer / construire / entraîner, avec coût) ; ce qui demande un humain. Fichiers sauvés par création ; fichiers
intermédiaires nettoyés à la fin.
