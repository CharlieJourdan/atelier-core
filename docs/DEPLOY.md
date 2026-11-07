# Mettre Atelier en ligne (bêta)

Ce guide décrit la mise en ligne de deux choses : le **site** (avec la console fondateur) et le **serveur Atelier
Cloud** (comptes, crédits, paiements, PC d'équipe, fournisseurs). L'app de bureau et l'app web se connectent ensuite au
serveur. Rien ici n'est fait automatiquement : chaque étape demande ton compte ou ton accord.

Coût mensuel de la bêta : environ **15 à 30 €** pour ce socle, plus un PC d'équipe par client (déjà inclus dans le prix
des plans).

| Élément | Coût |
|---|---|
| Serveur Atelier Cloud (Hetzner CX22 ou CX32) | 5 à 10 € / mois |
| Site sur Cloudflare Pages | 0 à 5 $ / mois |
| Sauvegardes sur Cloudflare R2 | quelques centimes |
| Vidéos des équipes sur Cloudflare R2 (§6 bis) | 0,015 $ par Go et par mois, sortie gratuite |
| Nom de domaine | environ 10 à 15 € / an |

---

## 1. Ce qu'il te faut

- un **nom de domaine** (par exemple `atelier-studio.fr`) chez Cloudflare ou un autre registrar ;
- un compte **Hetzner Cloud** (projet « Atelier ») ;
- un compte **Cloudflare** (Pages pour le site, R2 pour les sauvegardes) ;
- un compte **Resend** pour les e-mails (confirmation d'adresse, mot de passe oublié, reçus : section 8).

Prévois deux adresses :

- `api.<ton-domaine>` pour le serveur ;
- `<ton-domaine>` (ou `www`) pour le site.

## 2. Le serveur Atelier Cloud

1. Dans Hetzner, crée un serveur **Ubuntu 24.04**, type **CX22** (CX32 si tu attends du monde), en Allemagne
   (Falkenstein ou Nuremberg), avec ta clé SSH.
2. Dans ton DNS, ajoute un enregistrement `A` : `api.<ton-domaine>` → l'adresse IPv4 du serveur.
3. Copie le dépôt sur le serveur, dans `/opt/atelier`. Exemple avec un bundle git, comme pour le H1 :

   ```bash
   git bundle create atelier.bundle proto
   ```

   Puis sur le serveur :

   ```bash
   git clone -b proto atelier.bundle /opt/atelier
   ```

4. Lance l'installation en root :

   ```bash
   bash /opt/atelier/deploy/cloud/install.sh api.<ton-domaine> https://<ton-domaine>
   ```

   Le script installe Node 24, ffmpeg et Caddy (qui gère seul le HTTPS). Il crée l'utilisateur `atelier`, la clé
   maîtresse du coffre (`/etc/atelier-cloud/master.key`, mode 600, jamais affichée), la configuration, le service
   systemd et le pare-feu (seuls SSH, 80 et 443 sont ouverts). Le serveur lui-même n'écoute que sur 127.0.0.1 : seul
   Caddy l'atteint.

5. Crée ton compte administrateur. Le mot de passe est demandé sans écho :

   ```bash
   sudo -u atelier ATELIER_CLOUD_DATA=/var/lib/atelier-cloud ATELIER_CLOUD_MASTER_KEY_FILE=/etc/atelier-cloud/master.key npm --prefix /opt/atelier run cloud -- admin user add --email toi@<ton-domaine> --name Charlie --platform-admin --internal
   ```

6. Vérifie avec `systemctl status atelier-cloud` et `curl https://api.<ton-domaine>/v1/me`. La réponse attendue est une
   erreur « a bearer token is required » : c'est normal, et cela prouve que le serveur répond.

## 3. Le site

1. Construis le site en le branchant sur ton serveur (sous PowerShell, sur ce PC) :

   ```powershell
   $env:VITE_ATELIER_CLOUD="https://api.<ton-domaine>"; npm run site:build
   ```

2. Dans Cloudflare Pages, crée un projet et dépose le dossier `dist-web/site`, ou relie le dépôt avec la même commande
   et la même variable.
3. Associe le domaine `<ton-domaine>` au projet Pages.
4. Protège `/admin` avec **Cloudflare Access** (Zero Trust › Access › Applications : le chemin `/admin*`, ton e-mail
   seulement). La console vérifie déjà côté serveur que tu es administrateur : Access ajoute une deuxième porte.

Sans la variable `VITE_ATELIER_CLOUD`, le site reste en démonstration, avec des comptes fictifs dans le navigateur.

## 3 bis. L'app de bureau de la bêta

Au premier lancement, l'app demande de se connecter à Atelier Cloud (« Se connecter », « Créer un compte », ou
« Continuer sans compte (hors ligne) »). L'adresse du Cloud qu'elle utilise par défaut est fixée **à la construction** :

```powershell
$env:ATELIER_BETA_CLOUD="https://api.<ton-domaine>"; npm run dist        # ou npm run dist:mac sur le Mac
```

(`ATELIER_CLOUD_URL` marche aussi et passe devant.) Sans variable, l'app vise le Cloud local de développement
(`http://127.0.0.1:8787`). Aucune adresse n'est écrite dans le code. Chacun peut la changer : sur l'écran de bienvenue
(« Changer de serveur ») ou dans Réglages › Compte et crédits ; `ATELIER_CLOUD_URL` au lancement de l'app la remplace
aussi (tests). Les données de démonstration ne s'affichent plus jamais d'office : c'est le « Mode présentation » de
Réglages › Avancé, éteint par défaut, signalé par un bandeau quand il est allumé.

## 4. Les paiements d'abord (Stripe)

**Dans cet ordre, toujours : Stripe avant les clés payantes.** Tant que le paiement est simulé, n'importe quel compte
peut « payer » un plan ; c'est pourquoi le paiement simulé est refusé dès que les appels payants sont allumés, et le
serveur refuse de démarrer si `payments` vaut `stripe` sans ses deux secrets.

1. Dans Stripe, active **Stripe Tax** et crée un endpoint de webhook vers `https://api.<ton-domaine>/v1/billing/webhook`
   avec les événements suivants :
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
2. Mets les deux secrets dans le coffre : `vault set STRIPE_SECRET_KEY` et `vault set STRIPE_WEBHOOK_SECRET`.
3. Dans `config.json`, passe `"payments": "stripe"`, puis `systemctl restart atelier-cloud`.

Commence avec les **clés de test** de Stripe (`sk_test_…`). Le parcours du site redirige alors vers la vraie page de
paiement Stripe, avec les cartes de test de Stripe.

## 5. Les clés des fournisseurs (quand tu es prêt à payer)

Toujours sur le serveur, toujours sans écho. Sur le serveur, les variables `ATELIER_CLOUD_DATA` et
`ATELIER_CLOUD_MASTER_KEY_FILE` doivent être celles de l'étape 2.5.

```bash
sudo -u atelier … npm --prefix /opt/atelier run cloud -- vault set MINIMAX_API_KEY
```

Fais de même pour `GEMINI_API_KEY`, `FAL_KEY`, `HEDRA_API_KEY`, `PEXELS_API_KEY` et `HETZNER_API_TOKEN` (les PC d'équipe). Ensuite :

- dans `/var/lib/atelier-cloud/config.json`, passe `"paidCalls": "on"` et choisis les fournisseurs (voir
  [PROVIDERS.md](PROVIDERS.md)) ;
- pour les vrais PC d'équipe, ajoute la clé SSH publique de support dans `"machines": { "sshKeys": ["ssh-ed25519 …"] }`
  (sans elle, la création d'une vraie machine est refusée : personne ne pourrait s'y connecter) ;
- `systemctl restart atelier-cloud` ;
- `npm run cloud -- providers status` dit, pour chaque usage, s'il est réel ou en démo, et pourquoi.

## 6. Les sauvegardes

1. Crée un bucket R2 `atelier-cloud-backups` et une clé d'accès R2 limitée à ce bucket.
2. Installe Litestream (`https://litestream.io/install/debian/`) et copie `deploy/cloud/litestream.yml` dans
   `/etc/litestream.yml`. Remplace `__R2_ACCOUNT_ID__` par l'identifiant de ton compte R2.
3. Donne les clés au service : `systemctl edit litestream`, puis les lignes
   `Environment=LITESTREAM_ACCESS_KEY_ID=…` et `Environment=LITESTREAM_SECRET_ACCESS_KEY=…`. Termine par
   `systemctl enable --now litestream`.
4. Teste une restauration une fois : `litestream restore -o /tmp/test.db /var/lib/atelier-cloud/cloud.db`.

## 6 bis. Les vidéos sur la plateforme (Cloudflare R2)

Quand une fabrication se termine, son **kit de publication** (la vidéo, la miniature, `description.txt`, les sous-titres,
`metadata.json`) est envoyé à Atelier Cloud, qui le garde pour l'équipe. N'importe quelle personne de l'équipe le
télécharge ensuite depuis l'app de bureau, l'app web ou la page **Mes vidéos** du site, sans passer par l'ordinateur
d'équipe. Atelier ne publie jamais rien sur YouTube : le kit sert à publier à la main.

Sans réglage, le Cloud garde ces fichiers **sur son propre disque** (`<dossier de données>/teams` et `kits`). C'est
bien pour tester, pas pour la production : le disque du serveur est petit et disparaît avec lui. En production, mets
les fichiers dans un **bucket R2 à part** (jamais celui des sauvegardes de l'§6 : les droits et la conservation ne sont
pas les mêmes).

1. **Le bucket.** Dans Cloudflare › R2, crée `atelier-videos` (région automatique, accès **privé**, pas de domaine
   public). Garde l'identifiant de ton compte R2 (`<account>`).
2. **Une clé d'accès limitée.** R2 › Gérer les jetons d'API › crée un jeton **Object Read & Write** limité au bucket
   `atelier-videos`. Tu obtiens un identifiant de clé et un secret (affichés une seule fois).
3. **Les clés dans le coffre, avant la configuration**, sans écho :

   ```bash
   sudo -u atelier … npm --prefix /opt/atelier run cloud -- vault set R2_ACCESS_KEY_ID
   sudo -u atelier … npm --prefix /opt/atelier run cloud -- vault set R2_SECRET_ACCESS_KEY
   ```

4. **La configuration**, dans `/var/lib/atelier-cloud/config.json`, puis `systemctl restart atelier-cloud` :

   ```json
   {
     "storage": { "kind": "s3", "endpoint": "https://<account>.r2.cloudflarestorage.com", "bucket": "atelier-videos", "region": "auto" },
     "kits": { "retentionDays": 90, "byPlan": { "starter": 30, "agency": 365 } }
   }
   ```

   Si `kind` vaut `s3` et qu'une des deux clés manque dans le coffre, **le serveur refuse de démarrer** (même règle que
   pour Stripe) : il ne retombe jamais sur le disque local sans le dire.
5. **Ce que ça change.** Les téléversements et les fichiers produits par les fournisseurs vont dans le bucket (envoi en
   plusieurs parties au-delà de 16 Mo). Les téléchargements se font par des **liens signés de courte durée** (15 minutes,
   générés par le Cloud) qui pointent **directement vers R2** : les octets ne passent pas par le serveur du Cloud. Les
   liens `/files/…` que reçoivent les exécutants distants redirigent de la même façon (vers un lien valable 2 minutes).
6. **Règle de cycle de vie (la ceinture et les bretelles).** Le Cloud supprime lui-même les kits périmés (toutes les
   heures). Ajoute quand même, dans R2 › `atelier-videos` › Paramètres › Règles d'objet, une règle sur le préfixe
   `kits/` : « supprimer les objets après **400 jours** » (au moins la plus longue durée de `kits.byPlan`, avec une
   marge), et « abandonner les envois en plusieurs parties incomplets après **1 jour** ». Elle ne sert que si le
   serveur reste longtemps en panne. Pas de règle sur `teams/` : ce sont les fichiers des fabrications, gardés tant que
   l'équipe existe.
7. **Conservation par offre.** `kits.retentionDays` (90 par défaut) vaut pour tout le monde ; `kits.byPlan` donne une
   durée différente aux équipes qui ont un abonnement en cours (`starter`, `creator`, `studio`, `agency`, `network`).
   Un kit n'est plus visible dès sa date, puis supprimé à la prochaine passe horaire. Le kit d'une vidéo remplace le
   précédent quand il est complet ; un envoi abandonné depuis plus d'un jour est supprimé.
8. **Qui envoie, et combien.** Seule une équipe **avec une offre** (en cours ou en retard de paiement) ou un **PC
   d'équipe inscrit** envoie des kits : une simple inscription gratuite ne stocke rien (403). Chaque équipe a le
   stockage de son offre, comme sur la page des prix (`storageBytes` dans `cloud/src/billing/catalog.ts` : Starter 50 Go,
   Creator 150 Go, Studio 400 Go, Agency 1 To, Network 2 To), kits en cours d'envoi compris ; un fichier qui ne tient
   pas est refusé avant d'être lu (d'après sa taille annoncée), puis vérifié sur sa taille réelle. Au plus 4 kits en
   cours d'envoi par équipe.

**Coûts.** R2 coûte **0,015 $ par Go et par mois** et **ne facture pas la sortie** (pas de frais de téléchargement),
plus quelques centimes par million de requêtes. Une vidéo de 10 minutes pèse 100 à 300 Mo : 100 vidéos gardées 90 jours
font environ 20 Go, soit **0,30 $ par mois**. Compte 1,5 $ par mois pour 100 Go (PLAN-COMPLEXITE §E.5).

**Limites de cette version.** Un fichier du kit fait au plus 512 Mo (la limite d'un envoi ; au-delà la vidéo reste sur
l'ordinateur d'équipe et l'app le dit). L'envoi passe par le Cloud : **rien n'est lu avant que l'appelant soit identifié**, les
octets vont dans un fichier temporaire (`<dossier de données>/incoming`, vidé au démarrage), jamais en mémoire, puis vers
R2 une partie à la fois ; au plus 8 envois à la fois sur le Cloud et 2 par équipe (429 au-delà). Un envoi direct de l'app
vers R2 par lien signé est à faire. Une vidéo est repérée par `<identifiant de la base>-<numéro>` : l'identifiant est
tiré une fois par base (réglage `cloud.kitSource`), si bien que le « vidéo 3 » de l'app et celui du PC d'équipe ne se
remplacent pas ; les kits envoyés avant (numéro seul) restent lisibles.

## 7. Le PC d'équipe d'une équipe qui paie

Le détail technique est dans [BRAIN-HEADLESS.md](BRAIN-HEADLESS.md) §7. En bref :

1. **Le paiement crée la machine.** Quand Stripe confirme l'abonnement, le Cloud crée le PC d'équipe chez Hetzner
   (`machines provision`, aussi faisable à la main). Tant que `paidCalls` est éteint ou que `HETZNER_API_TOKEN` manque,
   ce sont des machines de démonstration (aucun serveur réel).
2. **Le code d'Atelier sur la machine.** Deux façons :
   - automatique : dépose une archive du dépôt (`git archive --format=tar.gz -o atelier.tgz proto`) à une adresse https
     que seul le Cloud connaît (un lien R2 signé, par exemple), puis dans `config.json` :
     `"machines": { "sshKeys": ["ssh-ed25519 …"], "appBundleUrl": "https://…/atelier.tgz" }` ;
     chaque nouvelle machine l'installe dans `/opt/atelier` au premier démarrage ;
   - à la main, connecté en `support` (`ssh support@<machine>`, le seul compte que SSH laisse entrer) : `scp` de
     l'archive, `sudo tar -xzf atelier.tgz -C /opt/atelier`, `sudo chown -R atelier:atelier /opt/atelier`,
     `sudo -u atelier -H env ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm --prefix /opt/atelier ci`, puis
     `sudo systemctl start atelier-brain`.
3. **La machine s'inscrit toute seule.** Le service `atelier-brain` (compte `atelier`) échange le jeton à usage unique de
   `/etc/atelier/enrol` contre son propre identifiant, efface le fichier et ouvre le relais **sortant** vers le Cloud.
   Aucun port n'est ouvert sur la machine (seul SSH, pour le support). Vérifie avec
   `npm run cloud -- machines list` puis, sur la machine, `journalctl -u atelier-brain` (« Atelier Cloud : relié »).
4. **L'équipe se branche.** Dans l'app (bureau ou web), après la connexion à Atelier Cloud : Réglages › Ordinateur
   d'équipe › « Se connecter via Atelier Cloud ». Pas de tunnel, pas de jeton à copier.
5. **Le client se connecte lui-même à Claude Code / Codex** sur sa machine (écran virtuel par tunnel SSH, voir
   BRAIN-HEADLESS.md §5), sous le compte `atelier` : `ssh support@<machine>` puis `sudo -iu atelier claude`
   (et `codex`). L'écran virtuel demande un mot de passe VNC, tiré au premier démarrage : il est dans
   `/home/support/screen-password` (lisible par `support` seul ; le service de l'écran reçoit sa propre copie par
   systemd, le cerveau n'y a pas accès).
6. **Deux comptes sur la machine.** `support` a les clés SSH et `sudo` ; `atelier` fait tourner le cerveau, l'écran et
   les agents du client, **sans `sudo` et sans clé SSH** (les agents gardent tous les droits dans son dossier personnel,
   qui contient les données et la clé du cerveau). Le service du cerveau voit les autres dossiers personnels en lecture
   seule et ne peut pas écrire dans `~/.ssh`.

Outils de support : `machines revoke <id>` (coupe l'identifiant de la machine), `machines enrol-token <id>` (nouveau jeton
d'inscription affiché une fois, à mettre dans `/etc/atelier/enrol` puis `systemctl restart atelier-brain`),
`machines calls [--team …]` (qui a appelé quelle méthode, jamais les arguments). `machines revoke` lancé à côté du serveur
coupe aussi le relais en cours : le Cloud relit l'identifiant avant de donner un appel à la machine. Réglages du relais
dans `config.json` : `"relay": { "timeoutMs": 60000, "rpcPerMinute": 900 }` (facultatif).

Un jeton d'accès direct au cerveau (dépannage par tunnel) : service arrêté, `sudo systemctl stop atelier-brain`, puis
`sudo -u atelier -H env ATELIER_DATA_DIR=/home/atelier/.local/share/atelier-brain npm --prefix /opt/atelier run
brain:headless -- --rotate-token` (affiché une fois ; refusé tant que le service tient son port), puis
`sudo systemctl start atelier-brain`.

Caddy transmet le long poll et les flux SSE sans rien à régler (pas de mise en tampon pour `text/event-stream`).

## 8. Les e-mails (Resend)

Le Cloud envoie, en français ou en anglais selon la langue du site à l'inscription :

- la **confirmation d'adresse** (à l'inscription, et sur demande avec « Renvoyer l'e-mail ») ;
- **mot de passe oublié** ;
- les **reçus** (plan, renouvellement, pack, recharge automatique), le **paiement refusé**, la **recharge refusée**, le
  **plan résilié** ;
- « **ton ordinateur d'équipe est prêt** », quand la création des machines est terminée ;
- l'**invitation dans une équipe** (envoyée par un propriétaire ou un administrateur ; lien à usage unique valable 7 jours, qui ouvre `…/invitation?token=…` sur le site).

Tant qu'une adresse n'est pas confirmée, le compte peut se connecter et parcourir son espace, mais il ne peut ni payer
(abonnement, pack, paiement simulé) ni lancer de travail payant (jobs) ; les ordinateurs d'équipe d'un plan payé ne sont
créés qu'une fois l'adresse confirmée (le lien de l'e-mail suffit, ils se créent alors tout seuls). Les comptes qui
existaient avant cette mise à jour comptent comme confirmés.

**Sans réglage, rien ne part.** Le Cloud utilise un faux expéditeur : chaque message est gardé dans sa base. En
développement, `npm run cloud -- mail list` les liste et `npm run cloud -- mail show <id>` affiche le texte, lien
compris. Pour envoyer pour de vrai, il faut Resend.

1. **Compte Resend.** Crée un compte sur `https://resend.com` (le palier gratuit suffit pour la bêta : vérifie ses
   limites du moment sur leur site).
2. **Domaine d'envoi.** Dans Resend › Domains › Add Domain, ajoute `<ton-domaine>` (ou un sous-domaine comme
   `mail.<ton-domaine>`, pour garder la réputation d'envoi à part). Resend affiche alors les enregistrements DNS à créer
   chez Cloudflare : recopie exactement leurs valeurs, sans les modifier.
   - **SPF** : un enregistrement `TXT` (et son `MX` de retour) sur le sous-domaine `send` ;
   - **DKIM** : un enregistrement `TXT` (ou `CNAME`) `resend._domainkey` ;
   - **DMARC** (recommandé) : un `TXT` sur `_dmarc`, par exemple `v=DMARC1; p=none; rua=mailto:toi@<ton-domaine>`, que tu
     durcis (`quarantine`) quand les envois sont propres.

   Dans Cloudflare, mets ces enregistrements en « DNS only » (nuage gris). Clique sur « Verify » dans Resend : le domaine
   doit passer à « Verified » (de quelques minutes à quelques heures).
3. **Clé d'API.** Resend › API Keys › Create API Key, avec la permission « Sending access » limitée à ce domaine. Mets-la
   dans le coffre, sans écho (même commande qu'à l'étape 2.5) :

   ```bash
   sudo -u atelier … npm --prefix /opt/atelier run cloud -- vault set RESEND_API_KEY
   ```

4. **Configuration.** Dans `/var/lib/atelier-cloud/config.json` :

   ```json
   "mail": { "kind": "resend", "from": "Atelier <bonjour@<ton-domaine>>", "siteUrl": "https://<ton-domaine>" }
   ```

   `from` doit être une adresse du domaine vérifié. `siteUrl` est le site : les liens des e-mails ouvrent
   `…/verifier?token=…` et `…/nouveau-mot-de-passe?token=…` (par défaut, le premier de `siteOrigins`). Puis
   `systemctl restart atelier-cloud`. **Le serveur refuse de démarrer** si `kind` vaut `resend` sans la clé dans le coffre,
   sans `from` ou sans adresse de site : il ne retombe jamais en silence sur le faux expéditeur.
5. **Boîte de réponse.** Les reçus disent « réponds à ce message » : l'adresse `from` doit donc recevoir. Avec Cloudflare
   Email Routing, redirige `bonjour@<ton-domaine>` vers ta boîte.
6. **Essai.** Crée un compte sur le site avec une vraie adresse : l'e-mail de confirmation arrive, le lien ouvre
   `/verifier`. Dans Gmail › « Afficher l'original », SPF et DKIM doivent afficher « PASS ». Essaie aussi « Mot de passe
   oublié » depuis la page de connexion.

Bon à savoir :

- les liens sont à **usage unique** et stockés **hachés** (la base seule ne permet pas de les reconstruire) ; la
  confirmation dure 24 heures, la réinitialisation 1 heure. Une réinitialisation déconnecte tous les appareils du compte ;
- « Mot de passe oublié » répond pareil que l'adresse existe ou non, et il est limité (3 demandes par heure et par
  adresse, 10 par heure et par adresse IP) ; le renvoi de la confirmation aussi (3 toutes les 15 minutes par compte) ;
- aucun pixel de suivi ni lien suivi dans les messages ; les reçus sont envoyés une seule fois par événement de paiement
  et par destinataire (propriétaires et administrateurs de l'équipe), jamais dans la transaction qui applique le
  paiement ;
- un envoi qui échoue ne fait échouer ni une inscription ni un paiement : il est noté dans l'audit (`admin audit`, action
  `mail.failed`, sans l'adresse ni le texte) et n'est pas renvoyé tout seul ;
- support : `npm run cloud -- admin user verify --email <adresse>` confirme une adresse à la main.

## 9. Ce qui n'est pas encore en ligne

- **Les PC d'équipe réels** : le code les crée, les inscrit et les relie ; restent à faire la mise à jour automatique du
  code sur les machines, le réveil d'une machine en veille sur un appel (aujourd'hui `machines resume`), et un relais
  partagé si le Cloud tourne un jour sur plusieurs serveurs (BRAIN-HEADLESS.md §7.5).
- **Les apps signées** : Windows (Azure Trusted Signing) et Mac (Apple Developer + notarisation).
- **Les factures officielles** : les e-mails de reçu résument chaque paiement (plan, montant HT, crédits) ; la facture avec TVA
  est celle de Stripe (Stripe Tax, étape 4). Les e-mails de relance (carte qui expire) restent ceux de Stripe.

## 10. Pousser une mise à jour de l'app aux testeurs

Le serveur gère aussi les **versions de l'app** : tu construis l'installeur sur ton PC (`npm run release`), le Cloud le garde
et le propose aux apps de tes testeurs, qui se mettent à jour toutes seules. Rien à installer de plus sur le serveur. La
boucle, les canaux (bêta, stable), le retour en arrière et ce que la signature change sont dans
[RELEASES.md](RELEASES.md). Les fichiers sont dans le stockage du Cloud (dossier de données, ou bucket R2 sous
`releases/` : pas de règle d'expiration dessus).
