# Le cerveau sur l'ordinateur d'équipe (sans écran)

Jusqu'ici, le « cerveau » d'Atelier (les agents, les fabrications de vidéos, les conversations, les idées, la base de
données) tournait **dans l'app de bureau**. Pour le SaaS, il doit tourner **sur l'ordinateur d'équipe** (une machine
Linux sans écran, par exemple chez Hetzner), et l'app (Mac, Windows ou web) devient une **télécommande**.

C'est le chantier PLAN-COMPLEXITE §A et §E.8. Phase 1 : le cerveau démarre sans Electron, il parle par HTTP, et l'app
sait s'y brancher par un tunnel SSH. Phase 2 (§7) : l'ordinateur d'équipe créé par Atelier Cloud s'inscrit tout seul et
garde une liaison **sortante** vers le Cloud ; l'app s'y relie « via Atelier Cloud », sans tunnel ni port ouvert.

```
 ton ordinateur                                        ordinateur d'équipe (Linux, sans écran)
 ┌──────────────────────────────┐   tunnel SSH         ┌──────────────────────────────────────┐
 │ app de bureau (Electron)     │ ─────────────────▶   │ npm run brain:headless               │
 │  main → POST /rpc, GET /events│  127.0.0.1:8790     │  le même cœur que l'app :            │
 │  (jeton chiffré, jamais vu    │                     │  base SQLite, migrations, agents,    │
 │   par l'écran)                │                     │  fabrications, chat, réglages…       │
 ├──────────────────────────────┤                     │  + l'API distante (HTTP, jeton)      │
 │ app web (navigateur)          │ ─────────────────▶  │                                      │
 │  fetch direct (CORS)          │                     └──────────────────────────────────────┘
 └──────────────────────────────┘
```

## 1. Lancer le cerveau sur l'ordinateur d'équipe

Il faut Node 22.12 ou plus récent, ffmpeg (pour les vidéos) et le dépôt d'Atelier.

```bash
git clone <le dépôt> atelier && cd atelier
npm install
npm run brain:headless
```

Au premier démarrage, il affiche :

```
Atelier — cerveau sans écran, version 0.1.0
  données   /home/<toi>/.local/share/atelier-brain
  écoute    http://127.0.0.1:8790  (POST /rpc, GET /events)

  Jeton d'accès (affiché UNE seule fois, copie-le maintenant dans Réglages › Ordinateur d'équipe) :
  atb_…
  Perdu ? Arrête le cerveau et lance --rotate-token : un nouveau jeton remplace l'ancien.

  tunnel    depuis ton ordinateur : ssh -N -L 8790:127.0.0.1:8790 <toi>@<ordinateur-d-equipe>
Prêt.
```

**Copie le jeton tout de suite** : il n'est écrit nulle part en clair (le cerveau ne garde que son empreinte SHA-256).
Perdu ? Arrête le cerveau, puis `npm run brain:headless -- --rotate-token` : c'est une commande **hors ligne**, qui
n'ouvre pas la base, affiche un nouveau jeton une fois et s'arrête (l'ancien ne marche plus) ; redémarre ensuite le
cerveau. Elle est refusée tant que le cerveau tient son port (rien n'est changé). Un cerveau qui tourne relit l'empreinte
dès que le fichier change : une rotation faite quand même (autre port, fichier remplacé) prend effet tout de suite. Un
démarrage qui n'obtient pas son port (`EADDRINUSE`) échoue avant d'ouvrir la base ou d'écrire un jeton.

Options utiles (`npm run brain:headless -- --help`) :

| Option | Variable | Défaut | Rôle |
|---|---|---|---|
| `--data <dossier>` | `ATELIER_DATA_DIR` | `~/.local/share/atelier-brain` | la base `atelier.db`, les vidéos, l'empreinte du jeton |
| `--key-file <fichier>` | `ATELIER_KEY_FILE` | `~/.config/atelier-brain/machine.key` | la clé de la machine (voir §4) |
| `--host <adresse>` | `ATELIER_BRAIN_HOST` | `127.0.0.1` | où il écoute |
| `--port <n>` | `ATELIER_BRAIN_PORT` | `8790` | `0` = au hasard |
| `--origin <origine>` | `ATELIER_BRAIN_ORIGINS` (virgules) | aucune | sites web autorisés à l'appeler (l'app web) |
| `--max-body-mb <n>` | | `32` | taille maximale d'une requête |
| `--rotate-token` | | | cerveau arrêté : nouveau jeton, affiché une fois, puis arrêt (refusé si le port est tenu) |
| `--no-mcp` | | | sans le pont MCP (les agents Claude Code n'ont alors pas les outils d'Atelier) |
| `--cloud-enrol` | | | se relie à Atelier Cloud (§7) ; refuse de démarrer sans fichier d'inscription ni identifiant enregistré |
| `--enrol-file <fichier>` | `ATELIER_ENROL_FILE` | `/etc/atelier/enrol` | le fichier d'inscription écrit par cloud-init |
| `--no-cloud` | `ATELIER_CLOUD=off` | | sans Atelier Cloud, même si un fichier d'inscription existe |
| `--token-file <fichier>` | `ATELIER_TEST_TOKEN_FILE` | | cerveau de **test** : se connecte avec la clé d'une équipe de test (`npm run cloud -- admin test-team create`, décision 0066), sans connexion dans un navigateur ; la clé reste en mémoire, jamais dans un journal ; refusée dès que l'équipe est révoquée |
| `--cloud-url <url>` | `ATELIER_CLOUD_URL` | celle déjà réglée | l'adresse d'Atelier Cloud (`https://…`, ou `http://` sur cet ordinateur) |

Les mêmes variables que l'app marchent aussi : `ATELIER_EXAMPLE=1` (charge l'espace d'exemple au premier démarrage ; sans
elle, le cerveau démarre vide et la première connexion ouvre l'intégration),
`ATELIER_RUNNER=off`, `ATELIER_AUTOMATIONS=off`, `ATELIER_FAKE_LLM=1` (équipe factice, pour les essais : aucun appel payant).

Pour qu'il tourne en permanence, un service systemd suffit (`ExecStart=/usr/bin/npm run brain:headless`,
`WorkingDirectory=` le dépôt, `User=` ton compte, `Restart=on-failure`). Il s'arrête proprement sur `SIGTERM`.
`GET /health` répond `{"ok":true}` sans jeton (pour une surveillance), et rien d'autre.

## 2. Le tunnel SSH

Le cerveau n'écoute que sur `127.0.0.1` : personne d'autre que la machine elle-même ne peut l'appeler. Depuis ton
ordinateur, ouvre un tunnel :

```bash
ssh -N -L 8790:127.0.0.1:8790 <toi>@ordinateur-d-equipe
```

Tant que cette commande tourne, `http://127.0.0.1:8790` sur **ton** ordinateur arrive sur le cerveau. (Windows 11 a
`ssh` intégré.) Si tu écoutes sur une autre adresse que 127.0.0.1, le cerveau l'affiche en ATTENTION : mets alors un
pare-feu, le jeton seul ne suffit pas à se protéger d'un balayage.

## 3. Brancher l'app

**App de bureau** : Réglages › **Ordinateur d'équipe** → adresse `http://127.0.0.1:8790` + le jeton → « Se connecter ».
L'app vérifie le jeton auprès du cerveau **avant** de le garder, puis le chiffre comme tes clés d'API (`safeStorage`) ;
l'écran ne le revoit jamais. En haut de l'app s'affiche « Connecté à l'ordinateur d'équipe <nom de la machine> » (point
vert = les événements arrivent en direct). Tous les écrans parlent alors au cerveau distant ; « Se déconnecter » revient
au cerveau de l'app.

**App web** (`npm run web:app:dev`, puis http://localhost:5180/web.html) : lance le cerveau avec
`--origin http://localhost:5180`, puis même page Réglages › Ordinateur d'équipe. Dans le navigateur, le jeton reste
**seulement dans l'onglet** (sessionStorage) : fermer l'onglet l'oublie. N'ouvre pas cette page sur un ordinateur
partagé. Une fois connectée, l'app web devient réelle : le bouton « Démo / Réel » apparaît, et « Réel » montre la vraie
équipe, les vraies chaînes, les vraies fabrications.

## 4. Sécurité : les choix

- **Jeton** : 32 octets aléatoires (`atb_…`), affiché une fois, stocké seulement en empreinte SHA-256 dans
  `<données>/brain-token.json` (droits 600). Comparaison en temps constant. Absent ou faux : la même réponse 401, qui ne
  dit rien d'autre. Le jeton voyage dans l'en-tête `Authorization`, jamais dans une adresse.
- **Écoute** sur 127.0.0.1 par défaut ; on y arrive par le tunnel SSH (chiffré, authentifié par ta clé SSH).
- **CORS** : seulement les origines données par `--origin` (exactes, pas de `*`). Une requête qui porte une autre
  origine est refusée (403), même avec le bon jeton.
- **Taille** : une requête de plus de 32 Mo (réglable) reçoit 413 sans être gardée en mémoire.
- **Secrets** (clés d'API, jeton Discord…) : chiffrés en AES-256-GCM avec la **clé de la machine**, un fichier de
  32 octets aléatoires créé au premier démarrage, droits 600 dans un dossier 700, hors du dossier de données. Le cerveau
  refuse une clé placée dans un dépôt git ou lisible par d'autres comptes. La clé n'est jamais affichée. Perdre ce
  fichier = retaper ses clés (les secrets chiffrés deviennent illisibles).
- **Appareil de bureau** : l'adresse est un réglage (`brain.url`, non modifiable par `settings.set`), le jeton un
  secret chiffré ; il ne revient jamais à l'écran, ni dans les journaux, ni dans les erreurs.
- Rien n'est écrit sur YouTube, aucun appel payant n'est fait par les tests (équipe factice).

## 5. L'API distante (pour les curieux)

- `POST /rpc` avec `{"method": "channels.list", "args": []}` → exactement l'enveloppe du bus IPC de l'app :
  `{"ok":true,"value":…}` ou `{"ok":false,"error":{"code","message"}}`. Une méthode inconnue répond la même erreur
  qu'en IPC. Les octets (`production.file`) voyagent en base64 (`{"$atelierBytes": "…"}`), décodés par le client.
- `GET /events` : flux Server-Sent Events, `event: changed` (`{"topic": "channels"}`…) et `event: stream` (les
  réponses des agents mot à mot), un commentaire toutes les 15 s pour garder la ligne ouverte.

```bash
curl -s -X POST http://127.0.0.1:8790/rpc -H "Authorization: Bearer $JETON" \
  -H 'content-type: application/json' -d '{"method":"app.info","args":[]}'
```

## 6. Ce qui ne marche pas encore à distance

- **Ouvrir le dossier du kit** (`production.revealPackage`) : pas d'écran là-bas. Réponse claire
  « Indisponible sur l'ordinateur d'équipe : … ». Le thème de la fenêtre et la connexion elle-même restent dans l'app.
- **Notifications système** (« une validation t'attend ») : elles ne viennent que du cerveau de l'app ; reliée au
  cerveau distant, l'app montre les validations dans ses écrans (événements en direct), sans bulle système.
- **Connexion Atelier Cloud** : le cerveau n'a pas de navigateur ; il **affiche** l'adresse d'autorisation dans son
  journal, à ouvrir sur ton ordinateur.
- **Pièces jointes lourdes** : limitées par `--max-body-mb` (32 Mo par requête par défaut).
- **Le cerveau local de l'app de bureau** reste démarré quand l'app est reliée (ses écrans ne l'utilisent plus, mais ses
  boucles tournent si tu les avais allumées) : à couper proprement dans une phase suivante.
- **Un seul jeton** pour l'accès direct (pas de droits par personne). Via Atelier Cloud, chaque personne de l'équipe
  passe avec son propre compte, mais toutes ont les mêmes droits sur le cerveau (pas encore de rôles par méthode).
- Via Atelier Cloud : voir §7.5 pour ce qui reste.

## 7. Via Atelier Cloud : sans tunnel, sans port ouvert

```
 app (bureau ou web)            Atelier Cloud (api.<domaine>)                 ordinateur d'équipe (Hetzner)
 ┌─────────────────────┐        ┌─────────────────────────────────┐          ┌──────────────────────────────┐
 │ POST /v1/team/brain/ │──────▶ │ relais (en mémoire)              │ ◀─────── │ atelier-brain (systemd)       │
 │      rpc             │        │  file d'appels par machine       │  GET     │  GET  /v1/relay/machine/next  │
 │ GET  /v1/team/brain/ │◀────── │  équipe vérifiée, limites, audit │  (long   │  POST /v1/relay/machine/reply │
 │      events (SSE)    │        │                                  │   poll)  │  POST /v1/relay/machine/events│
 └─────────────────────┘        └─────────────────────────────────┘          └──────────────────────────────┘
   jeton Atelier Cloud                                                         identifiant de la machine (amc_…)
   de la personne                                                              aucune connexion entrante
```

### 7.1 L'inscription (une seule fois)

Quand une équipe paie, le Cloud crée sa machine (`machines provision`, PLAN-COMPLEXITE §E.4). Le script cloud-init
(`cloud/src/machines/cloud-init.ts`) :

- écrit `/etc/atelier/enrol` (droits 600, propriétaire `atelier`) avec `ATELIER_CLOUD_URL` et un **jeton d'inscription
  à usage unique** (`enr_…`, le Cloud n'en garde que l'empreinte SHA-256) ;
- installe le code d'Atelier dans `/opt/atelier` si le Cloud a une archive (`machines.appBundleUrl` dans sa
  configuration, une adresse https d'un `.tar.gz`) ; sinon le code est copié à la main (docs/DEPLOY.md §7) ;
- crée **deux comptes** : `support` (les clés SSH, `sudo`, le seul que SSH laisse entrer : `AllowUsers support`) et
  `atelier` (le cerveau, l'écran virtuel, les agents du client), **sans `sudo` ni clé SSH** ;
- installe le service `atelier-brain` : `npm run brain:headless -- --cloud-enrol`, sous le compte `atelier`,
  `NoNewPrivileges`, `ProtectSystem=full`, `ProtectHome=read-only` avec `ReadWritePaths=/etc/atelier /home/atelier`
  (les agents gardent tous les droits dans le dossier personnel d'`atelier`, qui contient les données et la clé du
  cerveau ; les autres dossiers personnels, dont les clés de `support`, sont en lecture seule), `~/.ssh` en lecture seule,
  le mot de passe de l'écran inaccessible, redémarrage automatique. Dans ce mode, le jeton d'accès direct (§1) n'est
  **pas** écrit dans le journal système ; pour un accès direct de dépannage : service arrêté, `--rotate-token` à la main ;
- l'écran virtuel (`atelier-screen`) demande un **mot de passe VNC** tiré au premier démarrage : le fichier de x11vnc est
  à root (600) et systemd en donne une copie au seul service de l'écran (`LoadCredential`) ; la copie en clair pour la
  personne qui ouvre l'écran est dans `/home/support/screen-password` (600, `support`).

Au premier démarrage, le cerveau envoie le jeton à `POST /v1/machines/enrol`. Le Cloud répond avec l'**identifiant de la
machine** (`amc_…`, 32 octets aléatoires, gardé seulement en empreinte SHA-256, lié à la machine et à l'équipe). Le
cerveau le chiffre avec la clé de la machine (§4) dans `<données>/cloud-machine.json` (droits 600), puis **efface** le
fichier d'inscription. Ni le jeton ni l'identifiant ne sont jamais affichés ni écrits dans le journal. Un jeton déjà
utilisé, inconnu ou d'une machine supprimée reçoit la même réponse 401 ; le cerveau l'écrit clairement et continue de
servir son API locale. Si le Cloud ne répond pas encore (réseau pas prêt), il réessaie avec un délai croissant.

Identifiant perdu ou révoqué : `npm run cloud -- machines enrol-token <id>` affiche **une fois** un nouveau jeton à
mettre dans `/etc/atelier/enrol`, puis `systemctl restart atelier-brain`. `machines revoke <id>` (ou l'action « revoke »
de la console admin) coupe l'identifiant tout de suite ; la suppression d'une machine le révoque aussi.

### 7.2 Le relais

Le cerveau garde un **long poll sortant** : `GET /v1/relay/machine/next?wait=25` attend jusqu'à 25 s les appels de son
équipe ; il exécute chacun exactement comme `POST /rpc` (mêmes refus des méthodes sans écran, même enveloppe), répond
par `POST /v1/relay/machine/reply` `{id, response}`, et pousse ses événements (`changed`, `stream`) par lots vers
`POST /v1/relay/machine/events`. Après une coupure il se reconnecte (1 s, puis jusqu'à 30 s) ; un 401 veut dire
« identifiant révoqué » : il se réinscrit si un nouveau fichier d'inscription est là, sinon il arrête le relais et le dit.

Côté personnes (leur jeton Atelier Cloud habituel, aucun jeton du cerveau) :

- `POST /v1/team/brain/rpc` avec `{"method", "args", "machineId"?}` → exactement l'enveloppe du bus IPC
  (`{ok, value}` ou `{ok: false, error}`) ;
- `GET /v1/team/brain/events` : Server-Sent Events `changed` et `stream`, comme le `GET /events` du cerveau ;
- `GET /v1/team/machines` dit, pour chaque machine, `enrolled` et `online`.

Refus du Cloud (forme d'erreur du Cloud, traduite en français par l'app) :

| Cas | Réponse |
|---|---|
| machine en veille, arrêtée ou sans relais ouvert depuis 35 s | 503 `machine_offline` « L'ordinateur d'équipe est en veille ou hors ligne. » |
| pas de réponse de la machine en 60 s | 504 `timeout` |
| appel de plus de 8 Mo, réponse de plus de 32 Mo | 413 `too_large` (le cerveau remplace une réponse trop grosse par une erreur `TOO_LARGE`) ; une longueur annoncée trop grande est refusée avant d'être lue |
| plus de 64 Mo d'arguments en attente pour une machine, ou 512 Mo sur tout le Cloud ; plus de 64 Mo de corps JSON en cours de lecture pour une équipe (256 Mo en tout) | 429 `rate_limited` |
| plus de 8 Mo d'événements par minute pour une machine | 429 sur `POST /v1/relay/machine/events` |
| un client de flux SSE qui ne lit plus (plus de 1 Mo en attente) | le flux est fermé (le client se reconnecte) |
| plus de 900 appels par minute et par personne, plus de 64 appels en attente par machine, plus de 16 flux par équipe | 429 `rate_limited` |
| machine d'une autre équipe, ou équipe sans machine | 404 (la même réponse qu'une machine inconnue) |
| nom de méthode qui n'a pas la forme `module.methode` | 400, jamais transmis ni audité |

### 7.3 Sécurité : les choix

- **Aucun port entrant** sur l'ordinateur d'équipe : le pare-feu ne laisse entrer que SSH (support) ; le cerveau
  continue d'écouter sur 127.0.0.1 seulement (accès direct par tunnel toujours possible).
- **Trois secrets, trois rôles** : le jeton d'inscription (usage unique, effacé après usage), l'identifiant de la machine
  (une seule valeur vivante par machine, révocable, empreinte seulement côté Cloud, chiffré côté machine), le jeton
  Atelier Cloud de la personne (celui de sa connexion habituelle). Un jeton de personne n'ouvre pas les routes de la
  machine, et l'identifiant de la machine n'ouvre aucune route de personne.
- **Isolation par équipe** : une personne n'atteint que les machines de son équipe ; une machine ne voit que les appels
  qui lui sont destinés et ne peut répondre qu'à eux.
- **Audit** : chaque appel relayé est noté (table `relay_calls` : quand, équipe, personne, machine, méthode, issue,
  durée), **jamais les arguments ni la réponse**. `npm run cloud -- machines calls [--team …]` le lit ; conservé 90 jours.
- **Le Cloud ne lit pas les données de l'équipe** : arguments et réponses passent tels quels, en mémoire seulement.
- https obligatoire vers le Cloud (http seulement sur la machine même, pour les tests). Pareil pour l'adresse d'un
  cerveau en accès direct (`normalizeBrainUrl`) : `http://` seulement vers 127.0.0.1, `localhost` ou `[::1]` (le tunnel
  SSH), sinon `https://` : le jeton ne passe jamais en clair sur un réseau.
- **Rien n'est lu avant l'identification** : chaque route vérifie le jeton (ou l'identifiant de la machine) avant de
  lire un octet du corps ; une longueur annoncée au-delà de la limite de la route est refusée tout de suite. Un
  long poll ne reçoit jamais plus de 16 Mo d'arguments d'un coup.
- **Révocation** : `machines revoke` (outil admin, autre processus) coupe aussi le relais en cours : le Cloud relit
  l'identifiant avant de donner un appel à la machine et quand on lui demande si elle est en ligne ; son long poll
  ouvert se termine sans appel, ses flux d'événements se ferment.
- **Erreurs du cerveau** : une erreur plus longue que ce que le Cloud accepte (code 100, message 4 000 caractères) est
  coupée avant l'envoi ; toute autre réponse refusée par le Cloud (4xx) est remplacée par une courte erreur : la personne
  a une réponse, jamais 60 s d'attente.

### 7.4 Brancher l'app via Atelier Cloud

**App de bureau** : connecte-toi d'abord à Atelier Cloud (Réglages › Atelier Cloud). Réglages › **Ordinateur d'équipe**
montre alors les ordinateurs de ton équipe (allumé / en veille) et le bouton **« Se connecter via Atelier Cloud »**,
actif quand l'un d'eux est allumé. L'app vérifie que le relais répond (`app.machine`) avant de basculer ; aucun jeton du
cerveau n'est gardé (ta session Atelier Cloud sert de clé et se renouvelle seule). « Se déconnecter » revient au cerveau
de l'app. L'accès direct (adresse + jeton, tunnel SSH) reste en dessous.

**App web** (servie par le site sous `/app/`, même origine) : elle reprend la connexion du site (connexion ou
inscription sur le site, construit avec `VITE_ATELIER_CLOUD`) ; même page, même bouton. Le lien reste dans l'onglet.

### 7.5 Ce qui reste

- **Un seul serveur Cloud** : le relais vit en mémoire ; un redémarrage du Cloud coupe les appels en cours (ils
  finissent en `timeout`), les machines se reconnectent seules. Plusieurs serveurs demanderaient un bus partagé.
- **Pas de droits par méthode** : toute personne de l'équipe peut tout appeler (les plafonds de crédits restent ceux
  du Cloud). À faire avec les rôles d'équipe.
- **Grosses pièces jointes** : limitées à 8 Mo par appel et 32 Mo par réponse ; les vidéos finies ne passent pas par le
  relais mais par le **kit sur la plateforme** (§7.6).
- **Les réglages Atelier Cloud de l'app** (`cloud.*`) suivent le cerveau relié, comme en accès direct.
- **Le code sur la machine** : sans `machines.appBundleUrl`, il faut le copier (et le mettre à jour) à la main ; les
  mises à jour automatiques du cerveau sont à faire.
- **Réveil** : une machine en veille (instantané) ne se réveille pas sur un appel ; il faut `machines resume`.

### 7.6 Le kit de publication d'une vidéo (stockage sur la plateforme)

Quand une fabrication se termine, le cerveau envoie son paquet (vidéo, miniature, `description.txt`, sous-titres,
`metadata.json`) à Atelier Cloud **avec l'identifiant de la machine** (`POST /v1/relay/machine/videos/:id/kit…`, trois
étapes : début, un appel par fichier, fin). `:id` est la **référence** de la vidéo, `<identifiant de la base>-<numéro>`
(l'identifiant est tiré une fois par base, réglage `cloud.kitSource`) : le « vidéo 3 » du PC d'équipe et celui de l'app
ne se remplacent pas. `cloud.kitRef` la donne, répondu par le cerveau qui a la vidéo ; les kits envoyés avant (numéro
seul) restent lisibles. Il faut une offre ou un PC d'équipe inscrit, et le kit tient dans le stockage de l'offre
(docs/DEPLOY.md §6). Rien à régler : c'est automatique dès que la machine est inscrite
(`cloud.kitUpload` à `false` le coupe ; le bouton « Envoyer sur la plateforme » du planning l'envoie à la demande).

Le **téléchargement** ne passe pas par le relais : le cerveau n'a pas de jeton de personne. C'est l'app de la personne
(sa session Atelier Cloud) ou la page web (celle du site) qui demande `GET /v1/team/videos/:id/kit` au Cloud, puis suit
les liens signés vers le stockage. Même quand l'app est reliée à un ordinateur d'équipe, `cloud.kit` et
`cloud.kitDownload` sont donc répondus par l'app elle-même. Sans connexion au Cloud, ou si le Cloud est injoignable,
Planning › fiche vidéo › kit de publication retombe sur « Ouvrir le dossier » (local ; refusé sur une machine sans écran).

## 8. Ce qui le prouve

- `tests/unit/headless-boot.test.ts` : un Node séparé démarre le cerveau avec un crochet qui fait échouer tout import
  d'`electron` (le test vérifie d'abord que ce crochet attrape bien l'adaptateur Electron), et le cache des modules ne
  contient rien d'Electron. Plus le chiffrement par la clé de la machine.
- `tests/unit/headless-server.test.ts` : `app.info`, `channels.create/list`, `orchestra.status` à distance ; 401 sans
  fuite ; 413 ; méthode inconnue = même erreur qu'en IPC ; CORS ; événement `changed` après une écriture ; rotation du jeton.
- `tests/unit/brain-link.test.ts` : l'app de bureau reliée (appels routés, événements relayés, jeton chiffré) et le
  client de l'app web.
- `tests/unit/headless-cli.test.ts` : le vrai programme `brain:headless` (espace d'exemple, équipe factice, port au
  hasard) ; un client fait des modules de l'écran passe en mode Réel, voit les vraies chaînes et l'équipe, lance une
  fabrication et la retrouve dans `production.list`.
- `cloud/tests/cloud-relay.test.ts` : inscription une seule fois (deuxième usage et mauvais jeton refusés, identifiant
  gardé en empreinte, révocation par l'outil admin et à la suppression), un faux cerveau qui répond aux appels relayés,
  isolation des équipes, machine hors ligne, délai dépassé, 413 dans les deux sens, limite par minute, événements en
  SSE, audit sans les arguments, et le service `atelier-brain` dans cloud-init sans aucun secret du Cloud.
- Revue de sécurité (corps lus avant l'identification, stockage des kits, mémoire du relais, références des kits,
  erreurs longues, rotation du jeton, révocation, http, comptes de la machine) : `cloud/tests/cloud-bodies.test.ts`,
  `cloud/tests/cloud-kit-quota.test.ts`, `cloud/tests/cloud-relay-limits.test.ts`, `cloud/tests/cloud-machines.test.ts`
  (cloud-init), `tests/unit/cloud-kits-app.test.ts` (deux cerveaux d'une équipe), `tests/unit/relay-errors.test.ts`,
  `tests/unit/headless-rotate.test.ts`, `tests/unit/brain-link.test.ts` (http refusé hors de la machine).
- `tests/unit/relay-brain.test.ts` : un Cloud de test sur un port au hasard et le vrai cerveau dans le même processus,
  pointé dessus par un fichier d'inscription : il s'inscrit, efface le fichier, répond aux appels relayés et renvoie ses
  événements ; l'app de bureau se connecte « via Atelier Cloud » avec sa seule session Cloud ; un identifiant révoqué
  arrête le relais et la personne lit « en veille ou hors ligne ».
- Lint : `src/main/headless/**`, `src/main/brain/**` et `src/shared/brain-client.ts` ne peuvent pas importer `electron`
  ni `src/main/electron`.

## 9. Brancher son abonnement Claude ou Codex sur l'ordinateur d'équipe

Les agents du cerveau tournent sur l'ordinateur d'équipe : c'est **là** que ton abonnement doit être connecté, avec
**ta** connexion (docs/AGENT-RUNTIME.md §21). Atelier ne transporte jamais d'identifiant d'une machine à l'autre.

1. Dans l'app reliée au cerveau : Réglages › Claude › « Comptes de l'équipe d'agents » › **« Ajouter mon compte Claude
   Code »** (ou Codex). Le cerveau crée le dossier du compte sur l'ordinateur d'équipe
   (`<données>/orchestra/accounts/claude-code-1`, sous le compte `atelier`) et l'app affiche la commande à taper : le
   service du cerveau n'a pas d'écran, il n'ouvre pas de terminal lui-même.
2. Ouvre l'**écran à distance** de l'ordinateur d'équipe (son écran virtuel, §7.1 ; mot de passe dans
   `/home/support/screen-password`). Ouvre un terminal sur cet écran, sous le compte `atelier`, et colle la commande :
   `CLAUDE_CONFIG_DIR='<le dossier>' claude`, puis `/login` (Codex : `CODEX_HOME='<le dossier>' codex login`). Connecte-toi
   dans le navigateur de l'écran à distance, puis `/exit`.
3. De retour dans l'app : **« Vérifier »** (une toute petite question à Haiku, sur ton abonnement). Le compte passe
   « Prêt » ; les agents du cerveau l'utilisent, avec le relais vers un autre compte à la limite d'usage.

Les fichiers de connexion restent dans le dossier du compte, sur l'ordinateur d'équipe ; le cerveau ne les lit pas et
aucune réponse de son API n'en contient.

## 10. Toujours debout, rien de perdu : démarrage, plantage, sauvegarde (agents-5)

### 10.1 Le gardien et le démarrage automatique

Le cerveau tourne sous un **gardien** (`npm run brain:keeper -- <les options du cerveau>`, `src/main/headless/keeper.ts`) :
un petit processus qui le lance et le **relance s'il s'arrête sans qu'on le lui demande** (plantage, `kill -9`, mémoire
pleine), après 1 s, puis 2, 5, 15, 30, 60 s au plus ; le délai repart de 1 s quand un cerveau a tenu 10 minutes. Il ne
relance pas un cerveau arrêté proprement (code 0 : `SIGTERM`, `SIGINT`), ni un cerveau qui ne peut pas démarrer pour une
raison qu'un nouvel essai ne réglera pas : options fausses (code 2) ou **port déjà pris** (code 3 : un cerveau tourne
déjà ; il échoue avant d'ouvrir la base). Le nombre de relances arrive au cerveau (`ATELIER_BRAIN_RESTARTS`) et se lit
dans « Ordinateur d'équipe ». `--keeper-log <dossier>` écrit la sortie dans un fichier daté (les 40 derniers gardés),
`--keeper-pid <fichier>` y note le pid du gardien : une tâche planifiée, sans console, lance donc `node` directement.

- **Windows (le PC fixe aujourd'hui, H1 demain)** : `team-pc.ps1 install-task`, une fois, dans un PowerShell
  **administrateur**. La tâche « Atelier team PC » lance le gardien **au démarrage de la machine, sans session ouverte**
  (compte de Charlie en mode S4U : aucun mot de passe stocké), plus une seconde chance à l'ouverture de session, une
  minute après dans les deux cas. `install-task -DryRun` montre la tâche sans rien enregistrer ; `status` dit
  « autostart: at boot » ; `uninstall-task` l'enlève.
- **Linux** : le service systemd du §1 et de cloud-init (`Restart=on-failure`) fait déjà ce travail ; le gardien peut
  tourner dessous sans gêne (`ExecStart=/usr/bin/npm run brain:keeper -- …`).
- Après un redémarrage, `recover()` reprend chaque tâche restée `leased` / `running` (relancée tout de suite, la
  tentative en cours seulement est comptée), les routines manquées partent une fois, et l'équipe ne repart que si elle
  était allumée (l'interrupteur et la pause sont dans la base, décision 0017).

### 10.2 L'exercice de panne

`npm run team-pc:drill` (gratuit, hors ligne, dossier temporaire, équipe scriptée) le prouve avec les vrais morceaux :
le vrai cerveau sous le vrai gardien. Le principal crée une chaîne (un vrai effet de bord, noté dans `orch_effects`), et
le cerveau est **tué (`SIGKILL`) en plein tour**. Une copie des fichiers laissés montre le journal WAL, une base intacte
(`integrity_check = ok`), la tâche restée « running » et la chaîne enregistrée une fois. Le gardien relance le cerveau
tout seul ; `recover()` reprend la tâche, l'outil retrouve l'effet (« Already done in this task ») : la tâche finit
**une fois**, avec **une** chaîne. Puis une sauvegarde du dossier, restaurée dans un dossier vide, redonne les mêmes
agents, file, objectifs et chaînes. Code de sortie 0 = tout tient.

### 10.3 La sauvegarde de chaque nuit

Chaque nuit à 03:30 (heure locale ; `--backup-at HH:MM`, `--no-backup` pour l'enlever) et une fois peu après un démarrage
si la dernière bonne sauvegarde a plus de 26 h, le cerveau fait **une archive** :

- **ce qu'elle contient** : une copie cohérente de la base (`VACUUM INTO` depuis sa propre connexion : le cerveau continue
  d'écrire pendant ce temps, le WAL compris) et les fichiers de l'équipe (`orchestra/files`, `orchestra/agents`,
  `orchestra/bricks`, `attachments` ; un fichier de plus de 64 Mo est nommé, pas pris) ;
- **ce qu'elle ne contient pas** : les rendus (`production/` : les vidéos finies sont les kits sur le Cloud), les
  connexions des comptes Claude (`orchestra/accounts/` : elles restent sur la machine, on refait « Ajouter mon compte »),
  les caches, l'identifiant de la machine auprès du Cloud et le jeton d'accès direct ;
- **chiffrée sur la machine** (AES-256-GCM, clé dérivée de la clé de la machine) : le Cloud garde des octets qu'il ne peut
  pas lire. **Sans la clé de la machine, une sauvegarde est perdue** : garde une copie de `team-pc.key` hors de la machine
  (clé USB, gestionnaire de mots de passe) ;
- **gardée à deux endroits** : les 3 dernières dans `<données>/backups/`, et sur **Atelier Cloud** quand la machine est
  inscrite (`POST /v1/relay/machine/backups`, avec l'identifiant de la machine). Sur le Cloud, une sauvegarde est gardée
  **14 jours**, et la plus récente de l'équipe n'est jamais effacée par l'âge (une machine éteinte un mois garde la
  sienne) ; 256 Mo et 24 sauvegardes par jour au plus. Elles appartiennent à l'**équipe** : un nouvel ordinateur de la
  même équipe les voit et les télécharge.

Un échec (disque, Cloud injoignable) est réessayé une heure après. « Ordinateur d'équipe » montre depuis quand le cerveau
tourne, ses relances, la dernière sauvegarde (où, quelle taille, ou l'erreur) et la prochaine.

### 10.4 Restaurer

Les commandes (le cerveau peut tourner pendant les deux premières) :

| Commande | Ce qu'elle fait |
|---|---|
| `--backup-now` | une sauvegarde tout de suite (ici, et sur le Cloud si la machine est inscrite) |
| `--list-backups` | les sauvegardes de cet ordinateur et celles de l'équipe sur le Cloud |
| `--restore latest` / `bkp_…` / `<fichier.atb>` | restaure dans `--data`, un dossier **sans base** (jamais par-dessus) |

Il faut la **clé de la machine qui a fait la sauvegarde** (`--key-file`). Depuis le Cloud, la restauration utilise
l'identifiant déjà dans le dossier, sinon elle **inscrit la machine** avec le fichier d'inscription (`--enrol-file`) :
c'est le chemin d'un nouvel ordinateur. Elle vérifie la base écrite (`integrity_check`) et dit ce qu'elle contient
(agents, tâches, objectifs, chaînes, fichiers). Une sauvegarde faite par une version plus récente d'Atelier est refusée
(mets le code à jour d'abord) ; une plus ancienne se met à niveau au démarrage (migrations).

Sur le PC fixe : `team-pc.ps1 backup`, `team-pc.ps1 backups`, `team-pc.ps1 restore [-From latest|bkp_…|fichier]`. La
restauration arrête le cerveau, met le dossier actuel de côté (`data-before-restore-<date>`, l'identifiant de la machine
recopié), restaure, puis dit de relancer avec `start`.

Preuves : `tests/unit/team-pc-backup.test.ts` (archive chiffrée, sauvegarde à chaud restaurée à l'identique, ce qui ne
part pas), `tests/unit/team-pc-cloud-backup.test.ts` (envoi au Cloud, un nouvel ordinateur de l'équipe restaure
« latest » en s'inscrivant), `tests/unit/team-pc-keeper.test.ts` (gardien, horaire, vrai gardien contre un port pris),
`cloud/tests/cloud-backups.test.ts` (routes, équipes isolées, limites, rétention), `npm run team-pc:drill`.

## 11. Les vraies fabrications des sessions Claude : `scripts/brain-run.mjs` (solidite)

C'est **la seule façon** pour une session Claude Code de faire une vraie fabrication (payante). Plus de script RPC
inventé par chaque session : un seul lanceur, une seule règle de permission, un plafond en dollars toujours vérifié.

```bash
node scripts/brain-run.mjs start --data <dossier hors du dépôt> --token-file <fichier jeton hors du dépôt>
node scripts/brain-run.mjs call  --data <dossier> projects.create '[{"recipeId":3,"channelId":1,"title":"Essai","idea":"…"}]'
node scripts/brain-run.mjs quote --data <dossier> <projectId>
node scripts/brain-run.mjs run   --data <dossier> <projectId> --max-usd 1
node scripts/brain-run.mjs stop  --data <dossier>
```

| Commande | Ce qu'elle fait |
|---|---|
| `start` | démarre le cerveau de test (`--token-file`, `--no-mcp` sauf avec `--mcp` — les agents ont alors les outils d'Atelier, pour faire travailler l'équipe —, `--no-backup`) sur un port libre gardé dans `<données>/brain-run.state.json`, ou réutilise le sien ; avant chaque série d'appels il vérifie que le cerveau sert bien ce dossier `--data` (sinon refus : deux sessions ne se croisent jamais) |
| `call <méthode> ['[args JSON]']` | un appel RPC ; une méthode qui peut dépenser (`channelVoices.clone`, `channelClips.fromStock`, `analysis.start`…) exige `--max-usd` et le rapport donne la dépense mesurée ; une méthode qui lance une fabrication (`projects.run`, `production.start/retry/resume/redo`) est refusée : utilise `run` |
| `quote <projet>` | le devis réel (crédits, dollars au taux du cerveau) |
| `run <projet> --max-usd X` | devis → **refus si le devis dépasse X $** (rien n'est lancé) → lancement réel → suivi → rapport JSON |
| `example <conversation> --max-usd X` | le « oui » à « je te crée un exemple ? » d’une conversation de création, comme l’utilisateur : devis réel du projet vérifié d’abord (refus au-dessus de X, rien n’est dit), puis le « oui » de la conversation (qui met les provisoires : présentateur généré, voix par défaut) et le même suivi que `run` |
| `wait <run> --max-usd X` / `approve <run> <nœud> --max-usd X` | reprendre le suivi d'un run, ou valider une étape puis suivre |
| `stop` | arrête le cerveau lancé par `start` |
| `run <projet> --demo` | une fabrication **démo** gratuite (voix, script et images de démonstration ; montage et rendu réels), refusée si le devis débite quoi que ce soit ; plafond 0 $ |

Un cerveau **dans le VPS simulé** (Docker 4 vCPU / 8 Go) : `node scripts/vps-brain.mjs start --data <dossier> --token-file … --cloud-url <adresse publique du Cloud>`, puis `brain-run` comme d'habitude (décision 0091).

Pendant le suivi, le lanceur **annule le run** si la dépense dépasse `--max-usd`, s'arrête bruyamment sur une étape à
valider, un échec, ou si rien ne bouge pendant `--stall-min` minutes (20 par défaut ; `--wait-min` 120 au total). Le
rapport (stdout, JSON) donne le devis, la dépense, le rapport dépense/devis, la vidéo, le dossier du paquet, chaque
moteur par étape et **chaque élément démo** d'un run réel (`demoItems`, qui doit être vide). Codes de sortie : 0 fini,
1 erreur, 2 mauvaise commande, 3 devis au-dessus du plafond, 4 étape à valider, 5 plafond de dépense atteint (run
annulé), 6 run échoué/annulé/interrompu, 7 bloqué ou trop long.

Le jeton du cerveau est fait **hors ligne** (`--rotate-token`) avant le démarrage et rangé dans
`<données>/brain-run.access` (droits 600) ; le cerveau n'en écrit aucun dans son journal `<données>/brain-run.log`. Le
dossier `--data` doit être **hors du dépôt git** (le lanceur refuse sinon). Un cerveau lancé à la main avant : passer
son jeton avec `--access-file`.

**La règle de permission** qu'une session doit avoir pour lancer de vraies fabrications sans demande à chaque appel :
`Bash(node scripts/brain-run.mjs:*)` (et `PowerShell(node scripts/brain-run.mjs:*)` pour l'outil PowerShell). Charlie
l'ajoute lui-même dans ses réglages ; une session ne modifie jamais un fichier de réglages.

Preuve : `tests/unit/brain-run.test.ts` (devis refusé au-dessus du plafond, run annulé au-delà, étape, échec, blocage,
éléments démo signalés).
