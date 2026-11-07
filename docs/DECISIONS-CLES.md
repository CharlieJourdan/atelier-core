# Les décisions qui comptent

Un paragraphe par décision. Le registre complet (en anglais, avec le contexte et les preuves) est dans
`docs/decisions/` ; le numéro renvoie au fichier `docs/decisions/NNNN-*.md`.

**0001 — Clean room.** On construit notre propre travail et on ne copie rien de l'extérieur : ni code, ni noms, ni
regex, ni prompts, ni formats de log, ni fichiers de style d'un moteur tiers ou d'une app commerciale. On peut étudier
une méthode publique et la ré-implémenter à notre façon (0110). `scripts/cleanroom-check.mjs` le vérifie dans
`npm test`.

**0002 — Notre propre moteur.** La production vidéo est notre moteur TypeScript + ffmpeg (`src/engine/`), pas un outil
tiers piloté de l'extérieur.

**0003 — L'argent passe par le Cloud, en crédits.** Tout travail payant est un job du Cloud, facturé en crédits
(1 crédit = 0,01 €). Le client n'a jamais les clés des fournisseurs.

**0004 — Migrations figées.** Une migration publiée n'est jamais modifiée, supprimée ni renumérotée ; une branche qui
entre en collision prend le numéro libre suivant.

**0010 — Une technologie est du code.** Une technologie (brique) est codée une fois et partagée par toutes les
chaînes ; une chaîne ne la réécrit pas, elle la règle.

**0012 — Où tourne le calcul.** Le travail ne tourne jamais sur l'ordinateur de l'utilisateur : rendus à la demande
ailleurs, génération dans le Cloud.

**0013 — Routage des LLM.** Les agents utilisent l'abonnement Claude de l'utilisateur ou les crédits Atelier
(API Anthropic), au choix par équipe.

**0016 — Le compilateur de recettes.** Une recette relie des briques par des slots, avec des points de validation du
propriétaire et des réglages ouverts ; elle se compile en pipeline exécutable.

**0017 — Objectifs, portes et niveaux de validation.** L'équipe a des objectifs permanents ; les niveaux de validation
humaine sont appliqués par le runtime, pas laissés à la bonne volonté des agents.

**0021 — Trois couches : brique → moteur → style.** Une brique (ex. voix) a plusieurs moteurs (ai33, MiniMax…) et un
style la règle pour une chaîne.

**0025 — Actifs de chaîne et consentement.** Présentateur, voix, style, sponsor sont des actifs de la chaîne ;
consentement explicite avant tout clonage de visage ou de voix.

**0034 — Présentateur : fabriqué une fois, généré une fois par vidéo, puis découpé.** Le présentateur est créé une fois
par chaîne, généré en un bloc par vidéo puis coupé en plans : moins cher et cohérent.

**0046 — Un vrai job est débité de son vrai coût.** Les réponses de démo sont gratuites ; un vrai job est facturé à son
coût réel, à la fraction de crédit près.

**0052 — Les images disent les mots.** Chaque image illustre ce qui est dit à ce moment ; un contrôle d'illustration
tourne à chaque run.

**0055 — Les exigences sont des réglages mesurés.** Ce qu'une pipeline exige (durées, parts, mises en page) est un
réglage mesuré sur la référence, pas une limite du moteur.

**0069 — Briques de sourcing.** Une seule interface pour trouver des médias ; sources gratuites d'abord ; statut légal
et crédit pour chaque candidat ; une image générée ne remplace jamais une archive manquante.

**0076 — L'argent, c'est le Cloud.** On fait confiance au client pour les pipelines, jamais pour les prix : devis,
réservations et débits sont calculés et appliqués par le Cloud.

**0083 — Dire tôt ce qui ne peut pas être fait.** Une chaîne non reproductible est signalée avant de dépenser, avec ce
qui reste possible et des alternatives fidèles.

**0085 — Lire la vidéo entière, par des moyens légitimes.** Les yeux lisent toute la vidéo (fichier fourni,
téléchargement normal, ou Gemini sur le lien) ; jamais « les premières minutes ».

**0086 — Revue du montage à chaque rendu.** Chaque rendu est revu plan par plan contre le texte avant d'être montré.

**0089 — La création est une conversation.** « Créer une pipeline » est une conversation courte avec un agent de
création, pas un formulaire.

**0095 — Le moteur de clonage sur un contrat typé, phases P0–P10.** Chaque phase a ses entrées, ses sorties et son
contrôle de sortie (`src/shared/clone/`).

**0096 / 0098 — Faisabilité et définition mesurées, sur la vidéo entière.** P3 calcule la part reproductible sur le
temps d'écran mesuré ; P4 remplit chaque champ de la définition de style à partir de mesures.

**0097 — Juge aveugle et correction de la cause.** P6–P8 : un juge aveugle répond « même chaîne ? » ; on corrige la
cause (champ, brique, règle), pas le symptôme.

**0102 — Vraies erreurs = contrôles bloquants ; démo gratuite d'abord.** Les vraies erreurs sont refusées par du code ;
la ressemblance s'améliore en boucle ; une démo gratuite est jugée avant tout rendu payant.

**0105 — Une source gratuite ne coûte rien.** Ce qui ne nous coûte rien ne coûte rien à l'utilisateur dans le devis.

**0107 — Réserver le prix du moteur choisi.** Une étape réserve le prix du moteur qu'elle nomme, pas le pire cas de la
grille.

**0110 — rea-video : la méthode, pas le code.** On s'inspire de la méthode publique d'analyse plan par plan, sans
reprendre son code.

**0111 — Studio motion three.js.** Le motion 2D et 3D est une seule carte three.js rendue dans la page, à partir du
style motion mesuré.

**0112 — Partir d'une base quand elle convient.** P4/P5 partent d'une pipeline de base du même type, mais chaque
réglage est vérifié contre les mesures et remplacé s'il diffère.

**0113 — Le produit est une pipeline rétro-ingénierée.** Le moteur sort une pipeline (briques, réglages, entrées
humaines, impossibles, coût et temps), que l'on peut copier, traduire, adapter, tordre, mélanger ; la boucle n'attend
une personne que pour l'argent.
