# La démo web (toute l'app dans un navigateur, sans serveur)

Une version cliquable de **tout** le front d'Atelier, ouverte dans un navigateur, sans brain, sans Cloud, sans clé ni
compte. Les écrans sont **exactement** ceux de l'app de bureau (`src/renderer/`, rien n'est copié) ; seules les réponses
changent : un « bridge de démo » répond à chaque `window.atelier.call(...)` avec des **données fictives**.

## Lancer

| Commande | Ce que ça fait |
|---|---|
| `npm run demo:web` | serveur de dev sur http://localhost:5181/demo.html (rechargement à chaud) |
| `npm run demo:web:build` | dossier statique `dist-demo/` (non versionné) : l'app à la racine (`index.html`), le site dans `dist-demo/site/` |

`dist-demo/` marche depuis **n'importe quel serveur statique** (chemins relatifs, routage par `#`), par exemple
`npx serve dist-demo` ou `python -m http.server -d dist-demo`. Ouvrir le fichier en `file://` ne suffit pas (les modules
JavaScript l'interdisent) : il faut un petit serveur.

## Le parcours

1. **Mise en route** (premier passage) : les 8 étapes de l'onboarding client. Chaque étape a « Passer cette étape » en
   plus de « Continuer » : on peut tout remplir, ou tout passer. « Plus tard » (en haut à droite) saute tout.
2. **L'app** : Accueil, Planning, Production (vue d'ensemble, Pipelines prêtes, éditeur de pipeline, bibliothèque,
   en cours, **Créer une pipeline** avec sa conversation, la progression, le rapport : verdicts, ingrédients,
   propositions illustrées), Équipe (agents), Messages, Cerveau, Chaînes, Monétisation, Ordinateur, Validations,
   Réglages (toutes les pages, dont Admin et la Galerie des composants).
3. **Le site** (`dist-demo/site/`) : accueil, prix, inscription (avec « Continuer sans remplir »), « Mes vidéos » et la
   console fondateur, connectés à un compte fictif.

Le bandeau du haut dit **« Démo — données fictives »** ; son bouton **« Recommencer la démo »** efface ce que le
navigateur a retenu et repart de la mise en route. Chaque écran a sa propre adresse (`#/production/creer`,
`#/reglages/compte`…) : on peut l'envoyer, la recharger, revenir en arrière.

## Ce qui est réel, ce qui est démo

| Réel (le même code que l'app de bureau) | Démo (inventé, dans le navigateur) |
|---|---|
| Tous les écrans, composants, textes, thèmes clair/sombre, raccourcis (⌘K, ⌘J) | Les chaînes (4 chaînes fictives), vidéos, agents, messages, chiffres, crédits |
| La navigation, les formulaires, l'onboarding | Les réponses de l'API (`src/renderer/web/demo/api-*.ts`) |
| Les pipelines de base (`BASE_PIPELINES` du moteur) | Les rendus, analyses et rapports : une progression simulée par minuterie |
| | Les images : des vignettes SVG générées, aucune vraie vidéo |

Rien n'est envoyé : aucun appel réseau, aucun Cloud, aucune écriture YouTube, aucun crédit dépensé. Une action qu'aucune
donnée de démo ne couvre répond « Démo : rien n'a été fait ».

## Captures

Dans [`docs/demo/`](demo/) : mise en route, accueil, Lab de production, Pipelines prêtes, éditeur de pipeline,
Créer une pipeline et son rapport (côte à côte, ressemblance point par point), production en cours, équipe, site, console
fondateur.

## Ce qui n'est pas couvert

- **Aucune vraie vidéo** ne se lit : l'exemple du rapport est le petit clip synthétique du dépôt, les vidéos finies
  montrent un message calme à la place du lecteur.
- Le mode « réel » (bascule Mode présentation / réel, discussion avec le vrai moteur dans Messages, autopilote en
  direct) reste propre à l'app de bureau : la démo reste en mode démo.
- Les textes des agents de démo déjà présents dans `proto/` ne sont pas réécrits ; le propriétaire affiché est
  « Camille, Studio Démo » (fictif, appliqué au seul build de démo : `web/demo/persona.ts`).

## Pour le développeur

- Entrée : `src/renderer/demo.html` → `src/renderer/web/demo/main.tsx` (installe le bridge, puis monte l'app sous le
  bandeau). Config : `vite.demo.config.ts` ; le site : `vite.site-demo.config.ts` (`VITE_ATELIER_DEMO=1`).
- Bridge : `src/renderer/web/demo/bridge.ts`. Les réponses : un fichier par domaine (`api-lab`, `api-runs`,
  `api-create`, `api-settings`, typés par le contrat `src/shared/api`). Une méthode sans réponse est notée dans
  `window.__demoMissing` (à lire dans la console du navigateur) : c'est la liste de ce qui manque.
- Le mode démo ne touche ni l'app de bureau ni l'app web reliée (`web.html`, `npm run web:app`) : le routage par `#`, le
  bandeau et « Passer cette étape » ne s'allument que si `window.atelier.demo` est vrai (`src/renderer/lib/demo.ts`).
- Test : `tests/unit/demo-web.test.ts` (route par `#`, premier passage, bridge, une réponse pour chaque méthode chargée
  à l'ouverture d'un écran).
