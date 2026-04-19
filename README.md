# Gluetun-GUI

A responsive, data-driven web UI for managing a [**Gluetun**](https://github.com/qdm12/gluetun) VPN container. Built with **React**, **Vite**, and **Express**, it runs beside Gluetun (or on the same host), talks to **Docker**, and keeps configuration in a small set of files under **`DATA_DIR`**.

## Features

- **Dashboard** — Connection state, provider label (GUI vs container), protocol, CPU/RAM, throughput chart, Gluetun **image / digest**, PIA monitoring (connectivity + port forward). Quick actions: restart, **test VPN connectivity**, test failover, stop.
- **Network** — Tunnel vs LAN traffic, per-interface stats, session peaks.
- **Session history** — Bandwidth and metadata across container restarts (`sessions.json`).
- **Logs** — SSE multiplex of Gluetun + GUI process logs; filter and severity styling (theme-aware).
- **Settings** — Tabbed editor aligned with Gluetun env vars:
  - **VPN & tunnel** — Provider, WireGuard/OpenVPN, **PIA** WireGuard (regions, generate keys) or **PIA OpenVPN** (Gluetun **region labels** for `SERVER_REGIONS`, not WireGuard region IDs), generic providers with server filters.
  - **Firewall & ports** — Local subnets, input ports, VPN port forwarding.
  - **DNS & blocklists** — Resolvers, filtering toggles, blocklists.
  - **Local proxies** — Shadowsocks, HTTP proxy.
  - **This app** — **Theme**, **GUI password**, **notifications** (bell + toasts), **backup/export/import** of `gui-config.env`.
  - **Gluetun advanced** — Logging, health check, updater, system/public IP options, VPN hooks.
- **PIA automation** — WireGuard via `pia-wg-config`; multi-region **auto-failover** and optional port forwarding; OpenVPN uses Gluetun’s PIA **region** list (legacy internal host codes are mapped to regions on save).
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
# Open http://localhost:3000 — default password: gluetun-admin
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

## Password & backup

- Change **`GUI_PASSWORD`** under **Settings → This app**, or edit `gui-config.env`.
- **Export / import** (same tab): download `.env` (optional redacted import-safe copy); import replaces saved config and recreates Gluetun — confirm in the UI.

## Legacy migration

If older layouts used `server/.env` or `sessions.json` next to the server only, enabling **`DATA_DIR`** migrates those files into `./data` on first start.

## Supported providers (Gluetun)

AirVPN · CyberGhost · ExpressVPN · FastestVPN · Giganews · HideMyAss · IPVanish · IVPN · Mullvad · NordVPN · Perfect Privacy · Privado · **Private Internet Access** · PrivateVPN · ProtonVPN · PureVPN · SlickVPN · Surfshark · TorGuard · VPN Secure · VPN Unlimited · Vyprvpn · Windscribe · **Custom** (OpenVPN / WireGuard).
