# Gluetun-GUI

A beautiful, responsive, and data-driven graphical interface for managing your [Gluetun](https://github.com/qdm12/gluetun) VPN container. Built with React, Vite, and Express, this GUI allows you to monitor network traffic in real-time, configure settings across all major VPN providers, and manage your VPN tunnel directly from your browser.

## Features

- **Real-Time Dashboard** — Monitor CPU/RAM usage, network throughput, and connection status with live-updating charts
- **Network Monitor** — Dedicated page with VPN tunnel vs LAN traffic split, per-interface breakdowns, and peak speed tracking
- **Session History** — Automatic per-session bandwidth tracking across restarts, with per-interface (VPN/LAN) breakdown
- **Auto-Failover (PIA)** — Multi-region WireGuard auto-failover with automatic key generation, port-forwarding, and background session renewal
- **Multiplexed Logs** — Real-time aggregated logs from both the Gluetun engine and the GUI, with search, severity coloring, and debug toggle
- **Full Settings Management** — 100% parity with the official Gluetun Wiki. Configure DNS over TLS, Adblock, Shadowsocks, HTTP proxies, kill switches, firewall, port forwarding, advanced OpenVPN/WireGuard parameters, and more natively from the browser.
- **Docker Integrated** — Leverages the Docker socket to interact directly with the Gluetun container for instant config deployments without manual intervention.

## Quick Start

```bash
# 1. Create a project directory
mkdir gluetun-vpn && cd gluetun-vpn

# 2. Create the persistent data directory
mkdir data

# 3. Create docker-compose.yml (see below) and start
docker compose up -d

# 4. Open http://localhost:3000
#    Default password: gluetun-admin
```

### docker-compose.yml

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
      - "8888:8888/tcp"  # HTTP proxy
      - "8388:8388/tcp"  # Shadowsocks
      - "8388:8388/udp"  # Shadowsocks

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

> **Note:** No `env_file` or `gluetun.env` is needed. The GUI manages Gluetun's environment variables dynamically via the Docker API. Just configure everything through the web UI on first run.

## Architecture

```text
┌─────────────────────────────────────────────────┐
│  Browser (port 3000)                            │
│  ┌──────────┐ ┌──────┐ ┌─────────┐ ┌────────┐  │
│  │Dashboard │ │ Logs │ │ Network │ │Settings│  │
│  └──────────┘ └──────┘ └─────────┘ └────────┘  │
└──────────────────┬──────────────────────────────┘
                   │ REST / SSE
┌──────────────────▼──────────────────────────────┐
│  gluetun-gui container                          │
│  Express.js backend                             │
│  ├── /api/status   — container state            │
│  ├── /api/metrics  — live Docker stats          │
│  ├── /api/config   — read/write GUI config      │
│  ├── /api/sessions — session history            │
│  ├── /api/logs     — multiplexed SSE stream     │
│  └── /api/pia/*    — PIA WireGuard automation   │
│                                                 │
│  Persistent data (/data):                       │
│  ├── gui-config.env   — all GUI settings        │
│  ├── gluetun.env      — last Gluetun env backup │
│  ├── sessions.json    — session history         │
│  └── wireguard/       — generated WG configs    │
└──────────────────┬──────────────────────────────┘
                   │ Docker Socket
┌──────────────────▼──────────────────────────────┐
│  gluetun container (qmcgaw/gluetun)             │
│  VPN tunnel • Firewall • DNS • Proxies          │
└─────────────────────────────────────────────────┘
```

### How Configuration Works

1. **GUI is the single source of truth.** All settings are stored in `data/gui-config.env`.
2. When you save settings, the GUI:
   - Writes the config to `data/gui-config.env` (persistence)
   - Writes Gluetun-specific vars to `data/gluetun.env` (backup)
   - Recreates the Gluetun container via Docker API with the new environment
3. **No shared env files.** Gluetun doesn't read from disk — the GUI injects env vars directly into the container on every config change.

### Changing the Password

Add to `data/gui-config.env`:
```
GUI_PASSWORD=your_new_password
```

Or set it through the Settings page (under Advanced).

## Upgrading from Legacy Setup

If you previously used `gluetun.env` and `gui-settings.env` bind-mounts, the server will automatically migrate your files into the new `data/` directory on first start. No data is lost.

## Supported VPN Providers

AirVPN · CyberGhost · ExpressVPN · FastestVPN · Giganews · HideMyAss · IPVanish · IVPN · Mullvad · NordVPN · Perfect Privacy · Privado · Private Internet Access · PrivateVPN · ProtonVPN · PureVPN · SlickVPN · Surfshark · TorGuard · VPN Secure · VPN Unlimited · Vyprvpn · Windscribe · Custom (OpenVPN/WireGuard)
