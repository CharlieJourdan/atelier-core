# Atelier render worker (decision 0084, chantier vps-rendu). One image, two uses:
#   1. the remote render worker: a serverless CPU job (Scaleway Jobs, Modal, RunPod CPU) runs ONE render job
#      (`scripts/render-job.ts`: job JSON in, files out, see src/shared/render-job.ts);
#   2. the « simulated team VPS » on a developer PC: `docker run --cpus 4 --memory 8g` gives the 4 vCPU / 8 GB box of
#      decision 0084, and `scripts/vps-sim.mjs` runs the free demos and the brain inside it.
# Build context = the repository root:
#   docker build -f deploy/render-worker/Dockerfile -t atelier-render-worker:dev .
# Whisper (faster-whisper, CPU int8, model `small` baked in) is in by default; `--build-arg WHISPER=0` leaves it out.
FROM node:24-trixie-slim

ENV DEBIAN_FRONTEND=noninteractive \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PIP_NO_CACHE_DIR=1 \
    NODE_ENV=development

# ffmpeg 7.x (trixie) has every filter the render needs (RENDER_FILTERS: ass, drawtext, gradients, xfade…); fonts for
# drawtext fallbacks; procps for the measurements (ps, free).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fonts-dejavu-core procps ca-certificates python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

ARG WHISPER=1
RUN if [ "$WHISPER" = "1" ]; then \
      python3 -m venv /opt/whisper && /opt/whisper/bin/pip install faster-whisper==1.2.1 \
      && /opt/whisper/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')" ; \
    fi
ENV ATELIER_WHISPER_PYTHON=/opt/whisper/bin/python

WORKDIR /app
COPY package.json package-lock.json ./
# no postinstall scripts (electron, electron-builder): the worker never starts Electron
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npx playwright install --with-deps chromium-headless-shell \
    && rm -rf /root/.npm

COPY tsconfig*.json ./
COPY scripts ./scripts
COPY resources ./resources
COPY src ./src
COPY cloud ./cloud

# The render job program: reads the job from ATELIER_JOB_URL (or --job <file>), writes the result to
# ATELIER_RESULT_URL (or --out <dir>). See scripts/render-job.ts.
ENTRYPOINT ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", "--import", "./scripts/ts-resolve.mjs", "scripts/render-job.ts"]
