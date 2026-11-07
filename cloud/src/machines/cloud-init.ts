// What a new team computer installs on its first boot (cloud-init user data): two users, Node 24, ffmpeg, Chromium, the
// Claude Code and Codex CLIs, a virtual screen the owner can watch from the app (Xvfb + x11vnc behind noVNC, reachable
// only through an SSH tunnel, behind a VNC password), a firewall and automatic security updates, and the
// `atelier-brain` service.
//
// The users (security review, finding 10): `support` holds the SSH keys and sudo, and is the only one SSH lets in;
// `atelier` runs the brain, the screen and the customer's agents, with no sudo and no SSH key (the agents keep full
// rights in its home, which holds the brain's data and key folders). The brain's unit sees the other homes read-only,
// cannot write `~/.ssh`, and cannot read the screen's VNC password (root's file, handed by systemd to the screen alone;
// its plain copy is in support's home, for the person who opens the screen).
//
// The brain, run as `atelier`, enrols by itself (it trades the single-use token of /etc/atelier/enrol for its own
// credential, then deletes the file) and keeps an OUTBOUND relay to the Cloud: no port is opened
// (docs/BRAIN-HEADLESS.md §7). No secret of ours is on the machine: only that single-use token. The app's code comes
// from `appBundleUrl` (a .tar.gz) when given, else it is copied to /opt/atelier by hand and the service started then.
// The customer signs in to Claude Code / Codex himself, on this machine, as `atelier` (`sudo -iu atelier` from the
// support session; archived note RECAP (old repository) §5).
export interface CloudInitInput {
  /** Hostname, e.g. `atelier-team-ab12cd`. */
  hostname: string
  /** The Cloud's public base URL the machine enrols with. */
  cloudUrl: string
  /** Single-use enrolment token (its hash is stored by the Cloud). */
  enrolToken: string
  /** SSH public keys allowed in (the support key, the owner's). */
  sshKeys: readonly string[]
  /** https URL of the app's code (.tar.gz of the repository) installed at /opt/atelier. */
  appBundleUrl?: string
}

/** Where the brain lives on the machine (the systemd unit and docs/DEPLOY.md use the same paths). */
export const BRAIN_PATHS = {
  app: '/opt/atelier',
  enrolFile: '/etc/atelier/enrol',
  home: '/home/atelier',
  data: '/home/atelier/.local/share/atelier-brain',
  key: '/home/atelier/.config/atelier-brain/machine.key',
  /** The screen's VNC password (root only, handed to the screen service alone by systemd), and its plain copy for support. */
  vncPass: '/etc/atelier-screen/vnc.pass',
  supportScreenPassword: '/home/support/screen-password'
} as const

const SAFE_HOST = /^[a-z][a-z0-9-]{1,62}$/
const SAFE_URL = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/
const SAFE_TOKEN = /^[A-Za-z0-9_-]{16,200}$/
const SAFE_BUNDLE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~%/=&?-]*$/
const SAFE_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+( [^\n'"]{0,100})?$/

/** The cloud-init YAML. Inputs are checked strictly: nothing from them can break out of the YAML or of a shell line. */
export function cloudInit(i: CloudInitInput): string {
  if (!SAFE_HOST.test(i.hostname)) throw new Error('invalid hostname')
  if (!SAFE_URL.test(i.cloudUrl)) throw new Error('invalid Cloud URL')
  if (!SAFE_TOKEN.test(i.enrolToken)) throw new Error('invalid enrolment token')
  for (const k of i.sshKeys) if (!SAFE_KEY.test(k)) throw new Error('invalid SSH public key')
  if (i.appBundleUrl !== undefined && !SAFE_BUNDLE.test(i.appBundleUrl)) throw new Error('invalid app bundle URL')
  const p = BRAIN_PATHS
  // Electron's own binary is not needed on a machine without a screen.
  const install = i.appBundleUrl
    ? `  - [sh, -c, 'mkdir -p ${p.app} && curl -fsSL "${i.appBundleUrl}" | tar -xz -C ${p.app} && chown -R atelier:atelier ${p.app} && sudo -u atelier -H env ELECTRON_SKIP_BINARY_DOWNLOAD=1 sh -c "cd ${p.app} && npm ci"']\n`
    : ''
  const keys = i.sshKeys.map((k) => `      - ${k}`).join('\n')
  return `#cloud-config
hostname: ${i.hostname}
users:
  - name: support
    groups: [sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
${keys || '      []'}
  - name: atelier
    shell: /bin/bash
    lock_passwd: true
ssh_pwauth: false
disable_root: true
package_update: true
package_upgrade: true
packages:
  - ca-certificates
  - curl
  - git
  - ffmpeg
  - chromium-browser
  - fonts-inter
  - xvfb
  - x11vnc
  - novnc
  - websockify
  - ufw
  - unattended-upgrades
write_files:
  - path: ${p.enrolFile}
    permissions: '0600'
    owner: root:root
    content: |
      ATELIER_CLOUD_URL=${i.cloudUrl}
      ATELIER_ENROL_TOKEN=${i.enrolToken}
  - path: /etc/ssh/sshd_config.d/10-atelier.conf
    content: |
      # Only the support user comes in (its keys, no password); the brain's user never logs in over SSH.
      AllowUsers support
      PermitRootLogin no
  - path: /etc/systemd/system/atelier-screen.service
    content: |
      [Unit]
      Description=Atelier team screen (virtual display, watched through an SSH tunnel, VNC password)
      After=network.target
      [Service]
      User=atelier
      Environment=DISPLAY=:1
      LoadCredential=vnc.pass:${p.vncPass}
      ExecStart=/bin/sh -c 'Xvfb :1 -screen 0 1600x900x24 & sleep 2; x11vnc -display :1 -localhost -forever -rfbauth "\${CREDENTIALS_DIRECTORY}/vnc.pass" -quiet & websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900'
      Restart=always
      [Install]
      WantedBy=multi-user.target
  - path: /etc/systemd/system/atelier-brain.service
    content: |
      [Unit]
      Description=Atelier brain (the team computer's core, linked to Atelier Cloud by an outbound relay)
      Wants=network-online.target
      After=network-online.target
      ConditionPathExists=${p.app}/package.json
      [Service]
      User=atelier
      Group=atelier
      WorkingDirectory=${p.app}
      Environment=HOME=/home/atelier
      Environment=ATELIER_DATA_DIR=${p.data}
      Environment=ATELIER_KEY_FILE=${p.key}
      Environment=ATELIER_ENROL_FILE=${p.enrolFile}
      ExecStart=/usr/bin/npm run brain:headless -- --cloud-enrol
      Restart=on-failure
      RestartSec=10
      NoNewPrivileges=true
      PrivateTmp=true
      ProtectSystem=full
      ProtectHome=read-only
      ReadWritePaths=/etc/atelier ${p.home}
      ReadOnlyPaths=${p.home}/.ssh
      InaccessiblePaths=-/etc/atelier-screen -/run/credentials/atelier-screen.service
      [Install]
      WantedBy=multi-user.target
runcmd:
  - [sh, -c, 'curl -fsSL https://deb.nodesource.com/setup_24.x | bash -']
  - [apt-get, install, -y, nodejs]
  - [npm, install, -g, '@anthropic-ai/claude-code', '@openai/codex']
  - [chown, -R, 'atelier:atelier', /etc/atelier]
  - [chmod, '0700', /etc/atelier]
  - [chmod, '0600', ${p.enrolFile}]
  - [install, -d, -o, root, -g, root, -m, '0755', ${p.home}/.ssh]
  - [sh, -c, 'umask 077 && mkdir -p /etc/atelier-screen && pw=$(head -c 18 /dev/urandom | base64 | tr -d "/+=") && x11vnc -storepasswd "$pw" ${p.vncPass} >/dev/null && echo "$pw" > ${p.supportScreenPassword} && chown support:support ${p.supportScreenPassword}']
  - [chmod, '0600', ${p.vncPass}]
  - [systemctl, restart, ssh]
${install}  - [ufw, default, deny, incoming]
  - [ufw, allow, OpenSSH]
  - [ufw, --force, enable]
  - [systemctl, enable, --now, unattended-upgrades]
  - [systemctl, daemon-reload]
  - [systemctl, enable, --now, atelier-screen]
  - [systemctl, enable, --now, atelier-brain]
`
}
