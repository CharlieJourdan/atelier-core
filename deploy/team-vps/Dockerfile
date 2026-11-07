# The team VPS (decision 0084) as a customer gets it, simulated on a developer PC (chantier vps-essai): the render-worker
# image (node, ffmpeg, Chromium, Whisper small) plus the UNMODIFIED Claude Code CLI from npm, so the user signs in to his
# own subscription in the box himself (decision 0013: Anthropic's own login flow, Atelier never sees a credential).
# Build (after the render-worker image):
#   docker build -f deploy/render-worker/Dockerfile -t atelier-render-worker:dev .
#   docker build -f deploy/team-vps/Dockerfile -t atelier-team-vps:dev .
# Run: node scripts/vps-brain.mjs start --image atelier-team-vps:dev … ; sign-in: node scripts/vps-brain.mjs login …
ARG BASE=atelier-render-worker:dev
FROM ${BASE}
RUN npm install -g @anthropic-ai/claude-code --no-audit --no-fund && rm -rf /root/.npm && claude --version
