# Docker

## Images

| Role | Image | Registry |
| --- | --- | --- |
| **GUI** (this app) | `raddadengineer/gluetun-gui:latest` | [Docker Hub — `raddadengineer/gluetun-gui`](https://hub.docker.com/r/raddadengineer/gluetun-gui) |
| **VPN engine** (Gluetun) | `qmcgaw/gluetun:latest` | [Docker Hub — `qmcgaw/gluetun`](https://hub.docker.com/r/qmcgaw/gluetun) |

**Pull count (GUI)** — shown on the root README badge; it tracks Docker Hub’s registry total.

## Requirements

- Docker Engine with **Compose v2** (`docker compose`).
- The GUI container must mount **`/var/run/docker.sock`** read/write so the app can **inspect, stop, remove, and create** the Gluetun container when you save settings.
- A host directory mounted at **`/data`** inside the GUI (e.g. `./data:/data`) with **`DATA_DIR=/data`** so config and session files persist.

## Compose file

The canonical example lives in the repo root: **[`docker-compose.yml`](../docker-compose.yml)**.

Copy it next to a `data/` directory, then:

```bash
docker compose pull
docker compose up -d
```

### Inline example (same layout as repo)

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
      - "8888:8888/tcp" # HTTP proxy
      - "8388:8388/tcp" # Shadowsocks
      - "8388:8388/udp" # Shadowsocks
    # No env_file — the GUI writes Gluetun env via Docker API; configure VPN in the UI (port 3000).

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
      # Optional: JWT_SECRET=..., JWT_EXPIRES_IN=24h
    depends_on:
      - gluetun
```

Extend **Gluetun** `ports:` if your apps need more published ports; clients can also use `network_mode: "service:gluetun"` (see Settings → **This app** → compose snippet, or **`GET /api/compose-snippet`** in [OPERATIONS.md](OPERATIONS.md)).

## Hub image vs local build

- **Published releases:** `docker compose pull` to update the GUI from Docker Hub.
- **Developing this repo:** build the image yourself (see root **`Dockerfile`**) so the server and built SPA match your checkout.
- **Reproducible builds with metadata:** use root **`build.sh`** to inject git/build fields used by **`GET /api/about`** (and ensure `CHANGELOG.md` is present in the image for the “latest release” line).

If something fails to start or connect, see **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**.
