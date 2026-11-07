# Pousser une mise à jour aux testeurs

Tu modifies la version « dev » d'Atelier sur ton PC, puis tu l'envoies à tes testeurs d'une seule commande. Leur app la
trouve toute seule, la télécharge en arrière-plan et l'installe quand ils la ferment.

```
modifier  →  monter la version  →  npm run release  →  les testeurs reçoivent la MAJ
```

Tout passe par Atelier Cloud : il garde les installeurs, tient le « flux de mises à jour » que les apps lisent, et la
console fondateur (page **Versions**) montre ce que les testeurs reçoivent.

## 1. La boucle, pas à pas

1. **Modifier.** `npm run dev` lance l'app en développement : l'écran se recharge tout seul à chaque changement. Teste
   comme d'habitude (`npm run typecheck`, `npm run lint`, `npm test`).
2. **Monter la version.** Les testeurs ne reçoivent que des versions **plus hautes** que la leur.

   ```powershell
   npm version patch        # 0.1.0 → 0.1.1 (correction)
   npm version minor        # 0.1.1 → 0.2.0 (nouveauté)
   ```

   `npm version` change `package.json` et crée un commit et une étiquette git. Pour ne changer que le fichier :
   `npm version patch --no-git-tag-version`. Pour une version d'essai : `npm version 0.2.0-beta.1`.
3. **Pousser.**

   ```powershell
   npm run release -- --channel beta --notes "Ce qui change, en une phrase"
   ```

   La commande lit la version dans `package.json`, **refuse une version que le Cloud a déjà**, construit l'installeur
   Windows (`npm run dist`), envoie `Atelier-Setup-x.y.z.exe` et son `.blockmap`, puis publie.
4. **Les testeurs la reçoivent.** Leur app cherche une mise à jour au démarrage puis **toutes les 4 heures**. Elle la
   télécharge en arrière-plan ; elle s'installe quand l'app se ferme, ou tout de suite avec **Redémarrer pour installer**
   (Réglages › À propos). Le bouton **Rechercher des mises à jour** force la recherche.

Essaie d'abord à blanc : `npm run release -- --channel beta --dry-run` dit ce qu'elle ferait (version, canal, fichiers
attendus) et ne change rien.

### Les options

| Option | Effet |
|---|---|
| `--channel beta\|stable` | le canal (défaut `beta`) |
| `--notes "…"` ou `--notes-file notes.txt` | ce que les testeurs lisent dans l'app |
| `--cloud https://api.<domaine>` | le Cloud visé (sinon `ATELIER_CLOUD_URL`, sinon le Cloud local `127.0.0.1:8787`) |
| `--skip-build` | n'ouvre pas de construction : envoie ce qui est déjà dans `dist/` (pour **promouvoir** un build, voir §3) |
| `--dry-run` | ne change rien |
| `--platform win\|mac` | Windows (défaut) ; macOS demande une app signée et un `.zip`, voir §6 |

### Se connecter au Cloud

La commande agit en **administrateur de la plateforme**. Deux façons :

- **Cloud sur ce PC** (développement) : génère un jeton d'une heure.

  ```powershell
  $env:ATELIER_ADMIN_TOKEN = (npm run cloud --silent -- admin token --email toi@exemple.fr)
  npm run release -- --channel beta --notes "…"
  ```

- **Cloud en ligne** : sans jeton, la commande affiche une adresse et un code (comme la connexion de l'app) ; tu les
  approuves dans le navigateur avec ton compte administrateur. Rien à copier.

Le jeton n'est **jamais** passé en argument (il resterait dans l'historique du terminal) et la commande refuse une adresse
`http://` qui n'est pas ce PC, pour qu'il ne circule pas en clair.

## 2. Les canaux

- **Bêta** : les testeurs. Chaque nouvelle version part ici d'abord.
- **Stable** : les versions éprouvées, pour les utilisateurs qui préfèrent attendre.

Chaque app suit un canal (Réglages › À propos › Canal, **bêta** par défaut) et ne voit que son flux :
`<Cloud>/v1/updates/<canal>/<plateforme>/latest.yml` (`latest-mac.yml` sur Mac). Un canal sert la **version la plus haute
publiée**.

**Promouvoir** une version bêta qui a fait ses preuves vers le canal stable, sans reconstruire :

```powershell
npm run release -- --channel stable --skip-build --notes "Même version que la bêta 0.2.0"
```

## 3. Revenir en arrière

Console fondateur › **Versions** › **Retirer** (ou `POST /v1/admin/releases/<id>/withdraw`) : la version quitte le flux, et
la version publiée juste avant redevient la dernière. Les testeurs qui n'ont pas encore mis à jour ne la voient plus.

À savoir : une app **ne revient jamais en arrière toute seule**. Ceux qui ont déjà installé la version retirée la
gardent. Pour les corriger, publie une version **plus haute** (`npm version patch`, un correctif, `npm run release`).
Une version retirée par erreur se **republie** d'un clic. Un numéro de version publié ou retiré ne se réutilise pas : il
faut monter la version.

Un envoi interrompu laisse un **brouillon** (jamais visible des testeurs) : relance la même commande, elle le reprend, ou
supprime-le dans la console.

## 4. La console fondateur › Versions

- **Ce que reçoivent les testeurs** : la dernière version publiée de chaque canal et plateforme, avec l'adresse de son
  flux ;
- **Toutes les versions** : état (brouillon, publiée, retirée), fichiers, date, notes ; **Publier**, **Retirer**,
  **Republier**, **Supprimer** un brouillon ;
- le rappel de la boucle « modifier → npm run release → les testeurs reçoivent la MAJ ».

Sans `VITE_ATELIER_CLOUD`, la page montre des versions inventées (démonstration). Branchée sur le Cloud (voir
[DEPLOY.md](DEPLOY.md) §3), elle montre les vraies.

## 5. Côté serveur

- Les routes `/v1/admin/releases…` sont réservées à l'administrateur de la plateforme ; le jeton est vérifié **avant**
  de lire le moindre octet d'un installeur. Un fichier fait **400 Mo au plus** (l'installeur Windows en fait environ 130).
- Le Cloud calcule lui-même l'empreinte SHA-512 de ce qu'il a stocké : c'est elle que l'app vérifie avant d'installer.
- Les fichiers sont dans le stockage du Cloud : le dossier de données, ou le bucket R2 (§6 bis de DEPLOY.md), sous
  `releases/<identifiant>/`. Avec un bucket, le téléchargement redirige vers un lien signé de courte durée : les octets ne
  passent pas par le serveur. **Ne mets pas de règle d'expiration sur `releases/`.**
- Le flux et les téléchargements sont **publics** (une app n'a pas de compte à ce stade) et limités par adresse.
- Si le DNS passe par Cloudflare en mode proxy (nuage orange), le plan gratuit refuse les envois de plus de 100 Mo :
  laisse `api.<domaine>` en « DNS seul » (nuage gris), comme le décrit DEPLOY.md.

## 6. Signature : ce qui change pour les testeurs

- **Windows** : l'installeur n'est pas signé. La mise à jour **fonctionne** (l'app vérifie l'empreinte du fichier), mais
  Windows peut afficher un avertissement **SmartScreen** à la première installation : « Informations complémentaires »,
  puis « Exécuter quand même ». Prévenir les testeurs une fois suffit. La signature (Azure Trusted Signing) le supprime,
  voir DEPLOY.md §9.
- **macOS** : la mise à jour automatique **demande une app signée** (compte développeur Apple) et un fichier `.zip` en plus
  du `.dmg` (aujourd'hui `electron-builder.mac.config.mjs` ne produit que le `.dmg` et signe « ad hoc »). Tant que ce
  n'est pas fait, les testeurs Mac téléchargent la nouvelle version à la main ; `npm run release -- --platform mac` refuse
  d'envoyer sans `.zip`. Il n'y a pas de Mac de build sur ce PC : ce chemin n'est pas essayé ici.
- **Linux** : pas de mise à jour automatique.

## 7. Dépannage

| Symptôme | Cause probable |
|---|---|
| « La version x.y.z existe déjà » | monte la version (`npm version patch`) ; ou c'est la bonne : promouvoir = `--skip-build` sur l'autre canal |
| « Le Cloud refuse le jeton » | le jeton dure 1 h : refais `admin token`, ou supprime `ATELIER_ADMIN_TOKEN` pour la connexion par navigateur |
| « Ce compte n'est pas administrateur » | crée-le avec `--platform-admin` (DEPLOY.md §2, étape 5) |
| L'app ne trouve rien | le canal de l'app (Réglages › À propos) ; la version publiée est-elle **plus haute** que la sienne ? l'adresse du Cloud dans Réglages › Atelier Cloud |
| « Cette version de développement ne se met pas à jour » | normal : seule l'app **installée** (paquet) le fait |
| `npm run cloud -- releases list` | liste les versions, leur état et la dernière de chaque flux |
