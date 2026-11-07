# Le worker de rendu à distance (vps-rendu, décision 0087)

Une seule image Docker (`Dockerfile`) contient Node, notre code, ffmpeg 7, Chromium et Whisper `small`. Elle sert de deux
façons :
- comme **worker** : un fournisseur facturé à la seconde (Scaleway Jobs, Modal, RunPod) la démarre avec un seul réglage,
  `ATELIER_JOB_URL`, le lien du job ; elle fait le rendu et renvoie ses fichiers par des liens signés ;
- comme **VPS simulé** sur le PC : `node scripts/vps-sim.mjs` (voir research note vps-rendu-2026-11 (old repository)).

```
docker build -f deploy/render-worker/Dockerfile -t atelier-render-worker:dev .
```

## Un vrai rendu à distance : ce que tu dois créer (Scaleway d'abord, ≈ 0,01 € l'essai)

1. **Un compte Scaleway** (console.scaleway.com), avec un moyen de paiement. Les 200 000 vCPU-s gratuits par mois couvrent
   ≈ 300 minutes de vidéo.
2. **Un registre d'images** (Container Registry, région Paris), pour y pousser l'image. Elle doit être construite en
   `linux/amd64` : sur le PC Windows c'est déjà le cas, pas sur le Mac.
   ```
   docker login rg.fr-par.scw.cloud/<ton-espace> -u nologin --password-stdin   (tu colles la clé secrète)
   docker tag atelier-render-worker:dev rg.fr-par.scw.cloud/<ton-espace>/atelier-render-worker:1
   docker push rg.fr-par.scw.cloud/<ton-espace>/atelier-render-worker:1
   ```
3. **Une définition de job** (Serverless → Jobs → Créer) :
   - image `…/atelier-render-worker:1` ;
   - **6 vCPU** (6000 mvCPU) et **12 Go** (12288 Mo), le maximum de Scaleway ;
   - délai maximum 1 h ;
   - aucune variable.
   Note son identifiant.
4. **Une clé API** (IAM → Clés API) avec le droit « ServerlessJobsFullAccess » sur ce projet. Note sa clé secrète.
5. **Un bucket R2** (Cloudflare) pour les fichiers du job. Le Cloud de la bêta garde ses fichiers dans son dossier : fais
   l'essai sur un Cloud à part, avec son propre dossier de données.
   ```
   $env:ATELIER_CLOUD_DATA = "$env:TEMP/atelier-render-try"
   npm run cloud -- key init
   ```
   Son `config.json` contient :
   ```
   { "paidCalls": "on", "storage": { "kind": "s3", "endpoint": "https://<compte>.r2.cloudflarestorage.com", "bucket": "atelier-render-try", "region": "auto" } }
   ```
6. **Les clés dans le coffre de ce Cloud** (tu les tapes, elles ne s'affichent pas) :
   ```
   npm run cloud -- vault set R2_ACCESS_KEY_ID
   npm run cloud -- vault set R2_SECRET_ACCESS_KEY
   npm run cloud -- vault set SCALEWAY_SECRET_KEY
   npm run cloud -- vault set SCALEWAY_JOB_DEFINITION_ID
   npm run cloud -- render status          (doit dire « scaleway  clés présentes »)
   ```
7. **Un job à rendre** (gratuit, sur le PC) : `node scripts/vps-sim.mjs --remote capture --bases story-short@1`, ce qui écrit
   `out/vps-sim/bundles/render.assemble_1-…`. Puis l'essai lui-même :
   ```
   npm run cloud -- render try --backend scaleway --bundle out\vps-sim\bundles\render.assemble_1-<…> --out $env:TEMPender-try-out --timeout-s 900
   ```
   La commande affiche d'abord « Coût maximum » (900 s × 6 vCPU ≈ 0,076 €). Un rendu de 22 s prend en réalité moins de 30 s
   facturées, soit ≈ 0,003 €. Elle affiche ensuite les secondes facturées, le prix et le film.

## Les deux autres fournisseurs (secours)

- **Modal** : un compte modal.com (30 $ offerts par mois) et `pip install modal`, puis `modal token new`. L'image doit être
  dans un registre que Modal lit. Ensuite :
  ```
  $env:ATELIER_RENDER_IMAGE = "<registre>/atelier-render-worker:1"
  modal deploy deploy/render-worker/modal_app.py
  ```
  Crée un « proxy auth token » (tableau de bord Modal ou `modal workspace proxy-tokens`). Mets dans le coffre
  `MODAL_RENDER_URL` (l'adresse `*.modal.run` de `web`), `MODAL_PROXY_KEY` et `MODAL_PROXY_SECRET`. ≈ 0,007 € l'essai.
- **RunPod** : un compte runpod.io, l'image `Dockerfile.runpod` poussée dans un registre et un endpoint serverless **CPU**
  sur cette image (0 worker actif). Mets dans le coffre `RUNPOD_API_KEY` et `RUNPOD_RENDER_ENDPOINT_ID`. RunPod ne publie
  pas son prix CPU à la seconde : le premier essai le dira.

Ces trois adaptateurs (`cloud/src/render/starters.ts`) sont écrits d'après la doc publique du 03/11. Aucun n'a encore été
appelé pour de vrai, et aucun ne l'est sans ses clés et sans `paidCalls` à « on ».
