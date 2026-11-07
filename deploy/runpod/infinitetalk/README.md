# Le présentateur sur un GPU loué (InfiniteTalk sur RunPod)

> **Écrit d'après le README public du dépôt `github.com/MeiGen-AI/InfiniteTalk` (licence Apache-2.0), lu le 2026-11-01. JAMAIS
> construit ni lancé.** Les noms d'options et le format du fichier d'entrée sont à vérifier au premier essai (voir « À vérifier »).

## À quoi ça sert

C'est le moteur `presenter:infinitetalk-gpu` d'Atelier : une photo qui parle avec TA voix, générée sur un GPU que tu loues à la
seconde chez RunPod. Si ça marche, c'est 5 à 40 fois moins cher que les moteurs hébergés. **Personne ne sait encore combien**
(estimation 0,005 $ par seconde de vidéo) : c'est le but du **benchmark à 20 $ maximum** (décision 0015), que tu lances toi-même.

## Ce qu'il te faut

- un compte RunPod avec un peu de crédit (20 $ suffisent largement) et une clé d'API (Settings → API Keys) ;
- Docker sur ton PC, ou le build GitHub de RunPod (voir l'étape 2) ;
- le Cloud d'Atelier qui tourne avec une adresse publique en https (`publicUrl` dans `config.json`) ou un stockage R2 : le GPU doit
  pouvoir télécharger la photo et la voix par un lien signé court (décision 0025, jamais un hébergeur public anonyme).

## Étape 1 : un volume pour les poids du modèle (une seule fois)

Les poids pèsent plus de 100 Go : ils ne sont pas dans l'image, ils vivent sur un **Network Volume** RunPod.

1. RunPod → Storage → New Network Volume : **150 Go**, dans un datacenter qui a des 4090 (ou L40S). Coût : environ 10 $ par mois.
2. Lance un pod **temporaire** (le moins cher, ex. une 4090 « community » à 0,34 $/h) avec ce volume monté sur `/runpod-volume`.
3. Dans le terminal du pod : `pip install huggingface_hub`, puis copie `download_weights.py` et lance `python download_weights.py`.
   Compte une à deux heures de téléchargement. Puis **arrête et supprime le pod** (sinon il continue de coûter).

## Étape 2 : l'image du travailleur

Deux façons, choisis la plus simple pour toi :

- **A. Docker sur ton PC** : `docker build -t <ton-registre>/atelier-infinitetalk:1 deploy/runpod/infinitetalk` puis
  `docker push …` vers un registre **privé** (Docker Hub ou GitHub Container Registry). Le build télécharge environ 10 Go.
- **B. Build GitHub de RunPod** : Serverless → New Endpoint → « GitHub Repo », choisis le dépôt privé, Dockerfile
  `deploy/runpod/infinitetalk/Dockerfile`. (Non vérifié : si le contexte de build n'est pas le dossier, les `COPY` échouent ; prends alors A.)

## Étape 3 : l'endpoint serverless

Serverless → New Endpoint, avec l'image de l'étape 2, et :

| Réglage | Valeur |
|---|---|
| GPU | **24 Go : 4090** (poids fp8, c'est le réglage par défaut) ou **L40S 48 Go** (mets alors la variable `QUANT` à vide et `PERSISTENT_PARAMS` à vide) |
| Max workers | **1** (jamais plus pendant le benchmark) |
| Active workers | **0** (on ne paie que ce qui tourne) |
| Idle timeout | **5 secondes** |
| FlashBoot | activé |
| Network volume | celui de l'étape 1 |
| Execution timeout | laisse la valeur par défaut : Atelier envoie sa propre limite à chaque travail |

Variables d'environnement utiles (toutes facultatives) : `QUANT` (`fp8` par défaut), `PERSISTENT_PARAMS` (`0` par défaut),
`LORA_FILE`, et, pour renvoyer les vidéos de plus de quelques secondes, **un bucket S3** (`BUCKET_ENDPOINT_URL`,
`BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY` : un bucket R2 privé convient). Sans bucket, le travailleur répond la vidéo
dans la réponse elle-même et refuse les clips de plus de 7 Mo avec un message clair.

## Étape 4 : le dire à Atelier

1. Mets la clé RunPod dans le coffre (rien ne s'affiche quand tu la tapes) : `npm run cloud -- vault set RUNPOD_API_KEY`
2. Dans `config.json` du Cloud :

```json
{
  "paidCalls": "on",
  "publicUrl": "https://ton-cloud.example",
  "realEngines": ["presenter:infinitetalk-gpu"],
  "infinitetalk": { "endpointId": "L'ID DE TON ENDPOINT", "gpu": "4090", "steps": 8, "maxGpuSeconds": 1800 }
}
```

`gpu` ne sert qu'à calculer le prix à la seconde (4090 = 1,34 $/h, L40S = 1,75 $/h). `maxGpuSeconds` est la limite d'UN travail.

## Étape 5 : le benchmark (20 $ au plus)

Une voix de 60 secondes ou plus (mp3 ou wav), une photo, et ffmpeg installé sur le PC :

```
npm run cloud -- providers try talkingAvatar --engine presenter:infinitetalk-gpu --image visage.png --audio voix.mp3 --bench --budget-usd 20 --out bench-gpu
```

La commande affiche d'abord **« Coût maximum : X $ (plafond 20 $) »** puis fait quatre essais l'un après l'autre (10 s en 480p,
10 s en 720p, 30 s en 720p, 60 s en 720p). Chaque essai a une limite de temps calculée sur le budget qui reste : le total ne peut
pas dépasser le plafond. Elle écrit `bench-gpu/bench.json`, les vidéos, et un tableau : secondes de GPU par seconde de vidéo,
dollars par minute de vidéo, secondes de démarrage à froid. **Regarde les vidéos** : la synchro des lèvres en français compte
autant que le prix.

## À vérifier au premier essai

- le nom exact des options de `generate_infinitetalk.py` : `--base_seed` et `--max_frame_num` ne sont pas dans le README lu ;
- la forme du fichier d'entrée (`prompt`, `cond_video`, `cond_audio.person1`) : compare avec `examples/single_example_image.json` du dépôt ;
- l'origine du LoRA des 8 pas (`LORA_REPO`, `LORA_PATH` dans `download_weights.py`) ;
- que la limite de réponse de RunPod accepte la vidéo en base64 (sinon : le bucket) ;
- la mémoire : si le travail est tué faute de mémoire sur la 4090, garde `QUANT=fp8` et `PERSISTENT_PARAMS=0`, ou passe à la L40S ;
- le démarrage à froid réel (chargement de 14 milliards de paramètres) : c'est le chiffre qui décide si on garde un travailleur actif.
