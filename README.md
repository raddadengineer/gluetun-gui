# Gluetun-GUI

A web UI for [**Gluetun**](https://github.com/qdm12/gluetun): change VPN settings, watch status and logs, and let the app **recreate the Gluetun container** over the Docker API — no manual `docker run` env juggling for day‑to‑day changes.

[![Docker Pulls](https://img.shields.io/docker/pulls/raddadengineer/gluetun-gui)](https://hub.docker.com/r/raddadengineer/gluetun-gui)

## Setup (Docker)

1. **Install** [Docker](https://docs.docker.com/get-docker/) with Compose on the machine that will run the VPN stack.

2. **Project folder** — Clone this repo **or** copy [`docker-compose.yml`](docker-compose.yml) into a folder that has an empty **`data/`** directory next to the compose file (the repo already has `data/` for local dev; for a minimal deploy, `mkdir data` is enough).

3. **Start the stack**
   ```bash
   docker compose pull
   docker compose up -d
   ```

4. **Open the UI** — [http://localhost:3000](http://localhost:3000) (or your host and mapped port).

5. **Sign in** — Default password is **`gluetun-admin`** until you set **`GUI_PASSWORD`** in **Settings → This app** or in `data/gui-config.env`. See [docs/OPERATIONS.md](docs/OPERATIONS.md).

6. **Configure the VPN** in **Settings** (provider, region, keys, …) and **Save**. The UI shows a diff, then recreates the **`gluetun`** container with the new environment.

**Images:** GUI `raddadengineer/gluetun-gui:latest` · VPN `qmcgaw/gluetun:latest`. More detail (ports, volumes, updates): **[docs/DOCKER.md](docs/DOCKER.md)**.

## What you get (short)

- **Dashboard** — Tunnel state, resources, quick actions (restart, VPN test, failover test).
- **Network & logs** — Traffic views, session history export, live logs.
- **Settings** — Tabs that map to Gluetun env vars (PIA WireGuard/OpenVPN, other providers, firewall, DNS, proxies, advanced).
- **Background monitor** — Optional PIA region rotation on repeated failures (full behavior: **[docs/MONITORING.md](docs/MONITORING.md)**).

Full feature list: **[docs/FEATURES.md](docs/FEATURES.md)**.

## Documentation

- **[docs/README.md](docs/README.md)** — full index (Docker, PIA, monitoring, proxy, troubleshooting, …)
- **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** — common failures
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — diagrams, persistence, API route tables

## Project meta

- **[LICENSE](LICENSE)** — ISC
- **[CHANGELOG.md](CHANGELOG.md)** — release notes
- **Current package version:** `0.0.4.1` (see `server/package.json`; also shown on **About**)
- **[`patches/README.md`](patches/README.md)** — build-time patches (e.g. `pia-wg-config` TLS fallback)
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — local dev and PR expectations
- **[SECURITY.md](SECURITY.md)** — how to report vulnerabilities

## Developing locally

Frontend (`app/`) and API (`server/`): see **[app/README.md](app/README.md)**.
