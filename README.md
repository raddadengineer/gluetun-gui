# Gluetun-GUI

A responsive, data-driven web UI for managing a [**Gluetun**](https://github.com/qdm12/gluetun) VPN container. Built with **React**, **Vite**, and **Express**, it runs beside Gluetun (or on the same host), talks to **Docker**, and keeps configuration in a small set of files under **`DATA_DIR`**.

First sign-in uses default password **`gluetun-admin`** unless **`GUI_PASSWORD`** is set (see **Password & backup**).

## Features

- **Dashboard** — Connection state, provider label (GUI vs container), protocol, CPU/RAM, throughput chart, Gluetun **image / digest** (optional **Docker Hub digest** hint), **last manual VPN connectivity check**, PIA monitoring (connectivity + port forward). Quick actions: restart, **test VPN connectivity**, test failover, stop.
- **Network** — Tunnel vs LAN traffic, per-interface stats, session peaks; **session history CSV export**.
- **Session history** — Bandwidth and metadata across container restarts (`sessions.json`).
- **Logs** — SSE multiplex of Gluetun + GUI process logs; filter and severity styling (theme-aware); **download** and **copy visible** snapshots; stream mode **last N lines + follow** or **from now (live only)** via query params.
- **Sidebar** — On **narrow viewports (≤900px)** the nav becomes a **collapsible drawer** (menu button, backdrop, Escape to close) so content uses the full width.
- **Settings** — Tabbed editor aligned with Gluetun env vars (save runs a **diff confirmation** before recreating Gluetun):
  - **VPN & tunnel** — Provider, WireGuard/OpenVPN, **PIA** WireGuard (regions, generate keys, **Port Forwarding** toggle) or **PIA OpenVPN** (credentials, **same Port Forwarding toggle**, **region labels** for `SERVER_REGIONS`, failover list, protocol/version; not WireGuard API region IDs). **Other providers:** server filters stay visible; **WireGuard-only** and **OpenVPN-only** blocks follow **VPN Type** (same pattern as PIA).
  - **Firewall & ports** — `FIREWALL_*` (outbound subnets, VPN/input ports, iptables log level), **IPv6** for upstream DNS (`DNS_UPSTREAM_IPV6`, mirrored with DNS tab), VPN port forwarding (`VPN_PORT_FORWARDING_*`).
  - **DNS & blocklists** — Resolvers, filtering toggles, blocklists, **IPv6 DNS** (same `DNS_UPSTREAM_IPV6` as Firewall tab).
  - **Local proxies** — Shadowsocks, HTTP proxy.
  - **This app** — **Theme**, **GUI password**, **notifications** (bell + toasts, optional **local quiet hours**), **Save all changes** and **Save & connect** (after a successful save, runs the same outbound VPN probe as Dashboard), **backup/export/import** of `gui-config.env`, **scheduled `DATA_DIR` backups** (`.tar.gz` under `backups/`), **compose client snippet** (copy `network_mode: service:gluetun`), **config diff history** viewer, **outbound webhooks** (with optional **server-side quiet hours**), **search** to filter fields on the active tab.
  - **Gluetun advanced** — Logging, health check, updater, system/public IP options, VPN hooks.
- **PIA automation** — WireGuard via `pia-wg-config`; multi-region **auto-failover** and optional port forwarding; OpenVPN uses Gluetun **region** labels from `servers.json`, maps legacy **`server_name`** tokens on load/save, and when **port forwarding** is on (`PIA_PORT_FORWARDING` or `VPN_PORT_FORWARDING`) only **PF-capable** OpenVPN regions are kept or listed.
- **Notifications** — In-app bell, deduped events (save, monitor, dashboard actions, log warnings), configurable sources and toast levels (`localStorage`).
- **Themes** — Multiple readable themes (`localStorage`).
- **Docker** — Recreate Gluetun with merged env on every save/import; engine container resolved reliably (name `gluetun`, not `gluetun-gui`).

Full diagrams and route tables: **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## Quick start

```bash
mkdir gluetun-vpn && cd gluetun-vpn
mkdir data
# Add docker-compose.yml (below), then:
docker compose up -d
# Open http://localhost:3000 and sign in with password: gluetun-admin (default until changed)
```

### `docker-compose.yml` (example)

```yaml
services:
  gluetun:
    image: qmcgaw/gluetun:latest
    container_name: gluetun
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    ports:
      - "8888:8888/tcp"
      - "8388:8388/tcp"
      - "8388:8388/udp"

  gluetun-gui:
    image: raddadengineer/gluetun-gui:latest
    container_name: gluetun-gui
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/data
    environment:
      - DATA_DIR=/data
    depends_on:
      - gluetun
```

Rebuild the **GUI** image after pulling or changing this repo so the server and static UI match.

## Architecture (short)

```
Browser :3000  →  JWT REST + SSE  →  gluetun-gui (Express)
                         ↓
              gui-config.env, gluetun.env, sessions.json, wireguard/
                         ↓
                 Docker API (socket)  →  gluetun (VPN)
```

- **Single source of truth:** `DATA_DIR/gui-config.env` (or legacy `server/.env` if `DATA_DIR` unset).
- **Apply:** Save or import writes that file, writes `gluetun.env` backup, **stops/removes/creates** the Gluetun container with merged environment (no separate `env_file` required for Gluetun).
- **Persisted files (with `DATA_DIR`):** `gui-config.env`, `gluetun.env`, `sessions.json`, `wireguard/`, `vpn-connectivity-state.json` (manual VPN probe), `gui-homelab-state.json` (operator timestamps / webhook / backup hints), `config-diff-history.json` (redacted env diffs after saves), `backups/*.tar.gz` (optional scheduled or manual archives).

## Monitor and auto-failover

The GUI server runs a **background monitor** (`checkVPN`) against the **Gluetun engine** container (not the GUI container):

1. **Intervals** — When checks are passing, the loop runs about every **15 minutes** (`HEALTHY_INTERVAL`). When **VPN connectivity** or **PIA port forwarding** checks are failing, it runs about every **1 minute** (`CHECK_INTERVAL`) until healthy again.
2. **Warm-up** — After the engine container starts, connectivity failures are **not counted** toward failover for **~25s** (WireGuard) or **~120s** (OpenVPN), so brief bring-up noise does not trigger rotation.
3. **What is checked** — Outbound **public IP** is resolved from **inside** Gluetun (Gluetun control HTTP, then HTTPS/plain fallbacks). If **PIA port forwarding** is enabled in the saved GUI config, the monitor also tries Gluetun’s **port-forward** endpoint (or a status file fallback) and tracks **PF failure streaks** separately from **VPN failure streaks**.
4. **Threshold** — If **either** streak reaches **3** consecutive failures (`FAIL_THRESHOLD`), the server logs **persistent failure**, may send **webhooks** (`vpn_connectivity_failed` and/or `port_forwarding_failed`), then runs **`executeFailoverRotation()`**.
5. **Failover rotation (PIA-oriented)** — Reads **`PIA_REGION_INDEX`** and the ordered region lists from `gui-config.env`:
   - **WireGuard** with PIA credentials: advances index, updates `gui-config.env`, runs **`pia-wg-config`** for the next region, then recreates Gluetun with the new WireGuard material.
   - **OpenVPN + Private Internet Access:** maps the next token to a canonical **Gluetun `SERVER_REGIONS`** label (with PF validation when PF is on), then **`recreateGluetunContainer`** with that `SERVER_REGIONS` value.
   - **No regions / non-PIA paths / errors:** falls back to **restarting** the existing Gluetun container (`restart`) so traffic recovers when rotation logic does not apply.
6. **Manual test** — **Dashboard → Quick Actions → Test Auto-Failover** calls **`POST /api/test-failover`**, which runs the **same** `executeFailoverRotation()` (useful to verify ordering without waiting for failures).

Webhooks are **throttled per event type** (and `gluetun_container_missing` is limited to once per 5 minutes) to avoid storms during flapping.

## Password & backup

- **Default login password:** **`gluetun-admin`**, used when **`GUI_PASSWORD`** is not set in `gui-config.env`. Change it under **Settings → This app**, or set **`GUI_PASSWORD=...`** in `gui-config.env` (then save / restart the GUI container as appropriate).
- **Export / import** (same tab): download `.env` (optional redacted import-safe copy); import replaces saved config and recreates Gluetun — confirm in the UI.

## Security & automation

- **JWT signing:** Set **`JWT_SECRET`** (and optionally **`JWT_EXPIRES_IN`**, e.g. `12h` or `7d`) on the **gluetun-gui** container environment. If unset, a built-in development default is used (tokens survive image rebuilds until expiry).
- **TLS:** Put the GUI behind a reverse proxy with HTTPS for anything beyond a trusted LAN.
- **Save confirmation:** **Settings → Save** opens a diff of `gui-config.env` keys (secrets redacted) before recreating Gluetun.
- **Outbound webhooks:** Under **Settings → This app**, optional **`GUI_NOTIFY_WEBHOOK_URL`** receives JSON POSTs for monitor events (`gluetun_container_missing`, `vpn_connectivity_failed`, `vpn_connectivity_recovered`, `port_forwarding_failed`). Optional **`GUI_NOTIFY_WEBHOOK_SECRET`** is sent as `Authorization: Bearer …`. Optional **quiet hours** (server clock): **`GUI_NOTIFY_QUIET_ENABLED`** (`on`/`true`), **`GUI_NOTIFY_QUIET_START`**, **`GUI_NOTIFY_QUIET_END`** (`HH:MM`) — no webhook POSTs are sent during that window.
- **VPN check history:** Manual **Test VPN connectivity** (Dashboard or **Save & connect**) is stored under **`DATA_DIR/vpn-connectivity-state.json`** and shown on the overview.
- **Image hint:** For Docker Hub–style image names, the API compares the running digest to the registry manifest (best-effort; GHCR/private registries are skipped).
- **Save response:** **`POST /api/config`** (and import) can return **`containerDiff`** (redacted key-by-key delta for the next Gluetun env file vs the previous `gluetun.env` snapshot) and **`guiChangeCount`** for tooling.
- **Config diff history:** After each successful save, redacted GUI env diffs are appended to **`DATA_DIR/config-diff-history.json`** (cap via **`GUI_DIFF_HISTORY_MAX`**, default 30). **`GET /api/config/diff-history`** returns entries for the Settings viewer.
- **Data backups:** **`GUI_BACKUP_INTERVAL_HOURS`** (0 = off), **`GUI_BACKUP_RETENTION`**. Scheduled and **`POST /api/homelab/backup-run`** write **`DATA_DIR/backups/*.tar.gz`** (gui-config, sessions, VPN probe state, `gluetun.env`, `wireguard/` when present). **`GET /api/homelab/backups`** lists archives.
- **Gluetun control proxy (authenticated):** **`GET /api/gluetun-control?path=/v1/...`** runs `wget` inside the engine container against `http://127.0.0.1:8000` (path must match `/v1/...`). Handy for port-forward JSON without `docker exec` by hand.
- **Compose snippet:** **`GET /api/compose-snippet`** returns a minimal YAML fragment for a **client** service using `network_mode: "service:<gluetun-container-name>"`, with optional port-binding hints from the running engine inspect.
- **`GET /api/status`** includes a **`homelab`** object (from **`gui-homelab-state.json`**) with timestamps for monitor ticks, last webhook attempt, last config save, last backup, etc., for scripts or future UI.

## Legacy migration

If older layouts used `server/.env` or `sessions.json` next to the server only, enabling **`DATA_DIR`** migrates those files into `./data` on first start.

## Supported providers (Gluetun)

AirVPN · CyberGhost · ExpressVPN · FastestVPN · Giganews · HideMyAss · IPVanish · IVPN · Mullvad · NordVPN · Perfect Privacy · Privado · **Private Internet Access** · PrivateVPN · ProtonVPN · PureVPN · SlickVPN · Surfshark · TorGuard · VPN Secure · VPN Unlimited · Vyprvpn · Windscribe · **Custom** (OpenVPN / WireGuard).
