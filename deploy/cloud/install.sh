#!/usr/bin/env bash
# Installs Atelier Cloud on a fresh Ubuntu 24.04 server (Hetzner CX22/CX32), behind Caddy (automatic HTTPS).
# Run as root:  bash install.sh api.example.com https://site.example.com
# It never asks for a provider key: those go into the vault afterwards, typed without echo (docs/DEPLOY.md).
set -euo pipefail

API_HOST="${1:?usage: install.sh API_HOST SITE_ORIGIN}"
SITE_ORIGIN="${2:?usage: install.sh API_HOST SITE_ORIGIN}"
REPO="${ATELIER_REPO:-/opt/atelier}"
DATA=/var/lib/atelier-cloud
KEY=/etc/atelier-cloud/master.key

case "$API_HOST" in *[!a-z0-9.-]*) echo "API_HOST must be a host name" >&2; exit 1 ;; esac
case "$SITE_ORIGIN" in https://*) ;; *) echo "SITE_ORIGIN must start with https://" >&2; exit 1 ;; esac

apt-get update
apt-get install -y ca-certificates curl git ffmpeg ufw unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
# Caddy (TLS certificates from Let's Encrypt, renewed by itself)
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

id atelier >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin atelier
install -d -o atelier -g atelier -m 700 "$DATA"
install -d -o atelier -g atelier -m 700 /etc/atelier-cloud

if [ ! -d "$REPO/.git" ]; then
  echo "Put the Atelier repository in $REPO first (git clone or a bundle), then run this again." >&2
  exit 1
fi
cd "$REPO"
npm ci
# the code stays root's: the service only reads it

# The vault's master key: created once, never overwritten, never inside the repository.
if [ ! -f "$KEY" ]; then
  sudo -u atelier ATELIER_CLOUD_MASTER_KEY_FILE="$KEY" npm run -s cloud -- key init "$KEY"
fi

# The Cloud's configuration: loopback only (Caddy forwards), the public host, the site's origin.
if [ ! -f "$DATA/config.json" ]; then
  cat > "$DATA/config.json" <<JSON
{
  "paidCalls": "off",
  "payments": "fake",
  "fakeRunpod": "off",
  "publicUrl": "https://$API_HOST",
  "publicHosts": ["$API_HOST"],
  "siteOrigins": ["$SITE_ORIGIN"],
  "machines": { "sshKeys": [] }
}
JSON
  chown atelier:atelier "$DATA/config.json"
  chmod 600 "$DATA/config.json"
fi

sed -e "s#__REPO__#$REPO#g" -e "s#__DATA__#$DATA#g" -e "s#__KEY__#$KEY#g" "$REPO/deploy/cloud/atelier-cloud.service" > /etc/systemd/system/atelier-cloud.service
sed -e "s#__API_HOST__#$API_HOST#g" "$REPO/deploy/cloud/Caddyfile" > /etc/caddy/Caddyfile

ufw default deny incoming
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now unattended-upgrades
systemctl daemon-reload
systemctl enable --now atelier-cloud
systemctl reload caddy

echo
echo "Atelier Cloud runs behind https://$API_HOST (systemctl status atelier-cloud)."
echo "Next: the platform admin account and the provider keys (docs/DEPLOY.md, steps 4 and 5)."
