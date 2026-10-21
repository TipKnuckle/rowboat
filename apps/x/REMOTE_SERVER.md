# Running rowboat-server on a remote machine

Core runs on one authoritative host; desktop and phone apps are clients.
Search keys, tool discovery, and the notmuch mail index belong to that host.
Sidebar visibility is a per-client preference. The server exposes the same
validated IPC schemas over authenticated `POST /rpc/{channel}`; remote errors
do not fall back to executing the new features on the client machine.

## macOS LAN host (Dagonet)

From `apps/x`, after building Harbor and installing both workspaces:

```sh
npm run deps
pnpm --filter @x/server build:headless
node scripts/install-headless-macos.mjs
```

The installer stages a separate release under `~/.local/share/rowboat-server`,
installs its native dependency, and registers `com.craigt.rowboat-server` as a
user launch agent. It owns `~/.rowboat`, listens on port 3220 on the LAN, runs
independently of SSH, and restarts after crashes. It starts at user login;
starting before login at boot requires a system LaunchDaemon and administrator
setup. Logs are under `~/Library/Logs/rowboat-server/`. Re-running the installer
deploys a new release without replacing the data directory. Rebuild/reinstall
after changing Node versions so native dependencies match.

Do not run a separate local desktop backend against this workdir. On the Mini,
use **Settings → Phone app → Connect to server** with Dagonet's LAN address
(`http://192.168.50.60:3220` on the current network) and the contents of
`~/.rowboat/server-key` on Dagonet. Reserve the host's DHCP address if it should
remain stable. The access code is a secret granting full account access.

Alternatively launch the desktop with `ROWBOAT_REMOTE_SERVER` and
`ROWBOAT_REMOTE_TOKEN` set as shown below. Model and search settings saved from
that client now live on Dagonet. The client must include this fork's UI changes
to show Search, Tool inventory, and Local mail.

Validate reachability **from the Mini**, not only the server:

```sh
curl --fail http://192.168.50.60:3220/health
```

All RPC, mail, and workspace data still require the bearer token. The
authenticated `GET /pairing` endpoint supplies the server's pairing metadata;
the desktop's phone QR points at the server and hides client-local network/key
controls in remote mode. HTTP/WebSocket access here is for the trusted LAN.
Cloudflare routing and installing a physical phone client are separate steps.

## Ubuntu / Tailscale alternative

## 1. Provision the box

- EC2: Ubuntu 24.04 LTS, t3.medium (2 vCPU / 4 GB), 20 GB gp3.
- Security group: **SSH (22) from your IP only. Nothing else.** All app
  traffic rides the tailnet, so the server is never exposed publicly — this is
  what makes `lanEnabled` (a 0.0.0.0 bind) safe below.
- On the box:

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                      # sign in with the same account as your Mac
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3
tailscale ip -4                        # note the 100.x.y.z address
```

- On your Mac: install Tailscale (tailscale.com/download), sign in with the
  same account. `ping <100.x.y.z>` should answer.

## 2. Build and ship the server

On your dev machine, from `apps/x`:

```sh
npm run deps                            # shared → core → server → client
cd apps/server && npm run build:headless
tar -C dist-headless -czf rowboat-server.tgz .
scp -i <key.pem> rowboat-server.tgz ubuntu@<public-ip>:
```

On the box:

```sh
mkdir -p ~/rowboat-server && tar -xzf rowboat-server.tgz -C ~/rowboat-server
cd ~/rowboat-server && npm install --omit=dev     # compiles node-pty for this host
mkdir -p ~/.rowboat/config
echo '{"lanEnabled": true}' > ~/.rowboat/config/server.json
node rowboat-server.cjs
```

First boot creates `~/.rowboat` and mints the auth token at
`~/.rowboat/server-key`. Copy it:

```sh
cat ~/.rowboat/server-key
```

For an unattended server, run it under systemd:

```ini
# /etc/systemd/system/rowboat-server.service
[Unit]
Description=rowboat-server
After=network-online.target tailscaled.service

[Service]
User=ubuntu
ExecStart=/usr/bin/node /home/ubuntu/rowboat-server/rowboat-server.cjs
Restart=always

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now rowboat-server`

## 3. Point the desktop app at it

```sh
ROWBOAT_REMOTE_SERVER=http://<100.x.y.z>:3220 \
ROWBOAT_REMOTE_TOKEN=<contents of server-key> \
npm run dev          # or open the packaged app with these env vars set
```

In remote mode main spawns no child server and runs no core: RPC calls,
the WS event feed, workspace file serving (`app://workspace/...`), and
reverse-call capabilities (notifications, open-url, browser control…) all
target the remote box. Notes, sessions, connectors, and the terminal show
the **server machine's** state — that is the point.

The phone pairs directly with the server the same way (it just needs
Tailscale, or `lanEnabled` on a shared LAN).

## Configuring the server

LLM provider keys live server-side: `~/.rowboat/config/models.json` on the
box (same schema as the desktop writes). Easiest bootstrap: copy your local
`~/.rowboat/config/models.json` to the box once — or edit models in the
desktop settings UI while connected remotely; the writes land on the server.

## Security model (Phase 8b)

- **Token encryption at rest**: the headless server has no OS keychain, so
  GitHub/ChatGPT tokens are encrypted with AES-256-GCM under a random key at
  `~/.rowboat/cipher-key` (0600). Key and data sit on the same disk — an
  attacker with full workdir access gets both; keep the box locked down and
  the disk encrypted. Tokens stored earlier by the Electron app (keychain-
  encrypted) can't be read here — sign in again on the remote server.
- **OAuth connect flows** work remotely: the server asks the connected
  desktop (over the WS reverse-call channel) to host the `127.0.0.1`
  callback listener, so the browser redirect lands on *your* machine and is
  relayed back to the server. No SSH port-forwarding needed. With no desktop
  connected, flows fall back to a listener on the server itself.
- **Transport**: bearer token over plain HTTP inside the tailnet. Tailscale
  encrypts on the wire (WireGuard); do not run this over untrusted networks
  without it (or a TLS reverse proxy).
