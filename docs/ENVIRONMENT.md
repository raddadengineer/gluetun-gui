# Environment reference

Variables fall into three groups:

1. **Container env** — set on the **`gluetun-gui`** service in Compose (or `docker run -e`). Read at **process startup** by Node.
2. **Build-injected** — baked into the image via Dockerfile `ARG`/`ENV` (typically from `build.sh`). Used by **About** / `GET /api/about`.
3. **`gui-config.env`** — written by the **Settings** UI and the config API. Includes **`GUI_*`** / **`PIA_*`** keys and **all Gluetun VPN/env** keys the app merges into the engine container on save.

## Container-only (GUI process)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| **`DATA_DIR`** | Recommended | _(unset)_ | Directory for `gui-config.env`, `sessions.json`, `wireguard/`, backups, homelab state, etc. |
| **`JWT_SECRET`** | Recommended in prod | _(persisted random)_ | HMAC secret for issued JWTs. If unset, a random secret is generated and stored in `${DATA_DIR}/jwt-secret` (or kept ephemeral in memory if `DATA_DIR` is unset). |
| **`JWT_EXPIRES_IN`** | No | `24h` | JWT lifetime (e.g. `12h`, `7d`). |
| **`PORT`** | No | `3000` | Port the GUI server listens on inside the container. |
| **`GLUETUN_CONTAINER_NAME`** | No | `gluetun` | Name of the target Gluetun container to manage (must match that service’s `container_name`). |
| **`CORS_ORIGIN`** | No | `http://localhost:3000` | Allowed CORS origin for the API. Set this if you browse the UI at a different host/port (e.g. `http://localhost:3011`). |
| **`GUI_AUTOSTART_GLUETUN`** | No | `on` | Container fallback when the key is **unset** in `gui-config.env`. Values treated as off: `off`, `false`, `0`, `no`. See also the same key under `gui-config.env` (file wins when set). |

If **`DATA_DIR`** is unset, legacy paths under `server/` may be used — prefer **`DATA_DIR=/data`** plus a volume mount.

### Compose values (repo `docker-compose.yml`)

```yaml
environment:
  - DATA_DIR=/data
  # Optional:
  # - JWT_SECRET=change-me
  # - JWT_EXPIRES_IN=24h
  # - GLUETUN_CONTAINER_NAME=gluetun
  # - GUI_AUTOSTART_GLUETUN=on
  # - CORS_ORIGIN=http://localhost:3011
```

The repo compose maps host **`3011`** → container **`3000`**. VPN credentials and most **`GUI_*`** settings belong in **`data/gui-config.env`** (via Settings), not on the Compose service. The **`gluetun`** service does not need an `env_file` — the GUI applies Gluetun env over the Docker API on save.

## Build-injected (image metadata)

Set at **image build** time (`Dockerfile` ARGs / `build.sh`). Not required for day-to-day Compose deploys of the published Hub image.

| Variable | Purpose |
| --- | --- |
| **`GLUETUN_GUI_RELEASE`** | Release version shown in About / `GET /api/about`. |
| **`GLUETUN_GUI_GIT_SHA`** | Git commit SHA. |
| **`GLUETUN_GUI_GIT_REF`** | Git ref (branch/tag). |
| **`GLUETUN_GUI_GIT_COMMITTED_AT`** | Commit timestamp. |
| **`GLUETUN_GUI_BUILD_TIME`** | Image build timestamp. |

## `gui-config.env` — not passed into Gluetun (GUI / PIA helpers)

The server keeps these keys in **`gui-config.env`** but **removes** them from the env object used to **create** the `gluetun` container (they are for the UI, PIA automation, or app-only behavior). Gluetun still receives the normal **`VPN_*`**, **`OPENVPN_*`**, **`WIREGUARD_*`**, etc., produced from your settings.

Toggle-style keys use **`on`** / **`off`** unless noted.

### Auth, notifications, backups

| Key | Default | Purpose |
| --- | --- | --- |
| **`GUI_PASSWORD`** | _(unset → login `gluetun-admin`)_ | Login password for the web UI. |
| **`GUI_NOTIFY_WEBHOOK_URL`** | _(unset)_ | Optional HTTPS URL for outbound JSON webhook POSTs (monitor events). |
| **`GUI_NOTIFY_WEBHOOK_SECRET`** | _(unset)_ | Optional `Authorization: Bearer …` value for webhooks. |
| **`GUI_NOTIFY_QUIET_ENABLED`** | _(off)_ | `on` / `true` to enable server-side quiet hours for webhooks. |
| **`GUI_NOTIFY_QUIET_START`** | `22:00` | Quiet window start (`HH:MM`, server clock). |
| **`GUI_NOTIFY_QUIET_END`** | `07:00` | Quiet window end (`HH:MM`). |
| **`GUI_BACKUP_INTERVAL_HOURS`** | `0` | Hours between scheduled **`DATA_DIR`** backups; **`0`** disables. |
| **`GUI_BACKUP_RETENTION`** | `10` | Max backup archives to keep (clamped **1–500**). |
| **`GUI_DIFF_HISTORY_MAX`** | `30` | Max entries in **`config-diff-history.json`** (clamped **5–200**). |

### Autostart

| Key | Default | Purpose |
| --- | --- | --- |
| **`GUI_AUTOSTART_GLUETUN`** | `on` (also via container env if unset here) | If the engine is down but `gui-config.env` has a full VPN profile, apply it after GUI start (same pipeline as Save & connect). File value wins when set; otherwise Docker **`GUI_AUTOSTART_GLUETUN`**. |
| **`GUI_AUTOSTART_DELAY_MS`** | `2500` | Delay before autostart apply (clamped **0–300000**). |

### Background monitor

| Key | Default | Purpose |
| --- | --- | --- |
| **`GUI_MONITOR_INTERVAL_MS_HEALTHY`** | `900000` | Poll interval when healthy (clamped **30000–86400000**). |
| **`GUI_MONITOR_INTERVAL_MS_FAILING`** | `60000` | Poll interval when failing (clamped **10000–3600000**). |
| **`GUI_MONITOR_FAIL_THRESHOLD`** | `3` | Legacy shared failure threshold (clamped **1–20**). Used when the specific keys below are unset. |
| **`GUI_MONITOR_FAIL_THRESHOLD_CONNECTIVITY`** | _(inherits legacy)_ | Consecutive connectivity failures before action (clamped **1–20**). |
| **`GUI_MONITOR_FAIL_THRESHOLD_PORT_FORWARDING`** | _(inherits legacy)_ | Consecutive port-forward failures before action (clamped **1–20**). |
| **`GUI_MONITOR_WARMUP_WIREGUARD_MS`** | `25000` | Warm-up after WireGuard apply before counting failures (clamped **5000–600000**). |
| **`GUI_MONITOR_WARMUP_OPENVPN_MS`** | `120000` | Warm-up after OpenVPN apply (clamped **15000–900000**). |

### qBittorrent integration

| Key | Default | Purpose |
| --- | --- | --- |
| **`GUI_QBITTORRENT_ENABLED`** | _(off)_ | Enable qBittorrent API integration. |
| **`GUI_QBITTORRENT_DASHBOARD_WIDGET`** | _(off)_ | Show qBittorrent widget on the Dashboard. |
| **`GUI_QBITTORRENT_URL`** | _(unset)_ | Base URL (e.g. `http://qbittorrent:8080`). |
| **`GUI_QBITTORRENT_USERNAME`** | _(unset)_ | WebUI username. |
| **`GUI_QBITTORRENT_PASSWORD`** | _(unset)_ | WebUI password. |
| **`GUI_QBITTORRENT_API_KEY`** | _(unset)_ | Optional API key; overrides username/password when set. |
| **`GUI_QBITTORRENT_INSECURE_TLS`** | _(off)_ | Allow insecure TLS to the qBittorrent URL. |
| **`GUI_QBITTORRENT_AUTO_PAUSE_ON_VPN_DOWN`** | _(off)_ | Pause torrents when VPN is down. |
| **`GUI_QBITTORRENT_AUTO_RESUME_ON_VPN_UP`** | _(off)_ | Resume torrents when VPN is up. |
| **`GUI_QBITTORRENT_AUTO_SYNC_PORT_FORWARD`** | _(off)_ | Sync listen port from Gluetun port forwarding. |
| **`GUI_QBITTORRENT_AUTO_BIND_TUN0`** | _(off)_ | Auto-bind network interface to `tun0`. |
| **`GUI_QBITTORRENT_KILL_SWITCH_ON_VPN_DOWN`** | _(off)_ | Kill-switch behavior when VPN is down. |

### SABnzbd integration

| Key | Default | Purpose |
| --- | --- | --- |
| **`GUI_SABNZBD_ENABLED`** | _(off)_ | Enable SABnzbd API integration. |
| **`GUI_SABNZBD_DASHBOARD_WIDGET`** | _(off)_ | Show SABnzbd widget on the Dashboard. |
| **`GUI_SABNZBD_URL`** | _(unset)_ | Base URL (e.g. `http://sabnzbd:8080`). |
| **`GUI_SABNZBD_API_KEY`** | _(unset)_ | SABnzbd API key. |
| **`GUI_SABNZBD_INSECURE_TLS`** | _(off)_ | Allow insecure TLS to the SABnzbd URL. |
| **`GUI_SABNZBD_AUTO_PAUSE_ON_VPN_DOWN`** | _(off)_ | Pause downloads when VPN is down. |
| **`GUI_SABNZBD_AUTO_RESUME_ON_VPN_UP`** | _(off)_ | Resume downloads when VPN is up. |

### `PIA_*` (stored for the UI; mapped before recreate)

| Key | Purpose |
| --- | --- |
| **`PIA_USERNAME`** / **`PIA_PASSWORD`** | PIA credentials in the UI; for **OpenVPN**, the server copies into **`OPENVPN_USER`** / **`OPENVPN_PASSWORD`** for Gluetun before stripping these keys. |
| **`PIA_REGIONS`** | Legacy / combined region helper text (see Settings). |
| **`PIA_WG_REGIONS`** / **`PIA_OPENVPN_REGIONS`** | Ordered region lists for WireGuard vs OpenVPN flows. |
| **`PIA_REGION_INDEX`** | Current failover index (monitor / rotation). |
| **`PIA_ROTATION_RETRIES`** / **`PIA_ROTATION_COUNT`** | Rotation bookkeeping used by the server. |

## Gluetun variables

Everything else stored in **`gui-config.env`** that is not in the GUI/PIA strip list is treated as **Gluetun configuration**: `VPN_SERVICE_PROVIDER`, `VPN_TYPE`, `SERVER_REGIONS`, OpenVPN/WireGuard keys, firewall, DNS, proxies, etc. Consult the **[Gluetun wiki](https://github.com/qdm12/gluetun-wiki)** for authoritative semantics.

## Secrets in exports

Exports and diff views **redact** known secret keys (including **`GUI_PASSWORD`**, **`GUI_NOTIFY_WEBHOOK_SECRET`**, **`PIA_PASSWORD`**, and keys matching password/secret/token patterns such as **`GUI_QBITTORRENT_PASSWORD`**). Treat **`GUI_QBITTORRENT_API_KEY`**, **`GUI_SABNZBD_API_KEY`**, and any full `gui-config.env` backup as **sensitive** regardless.

## Local development only

| Variable | Purpose |
| --- | --- |
| **`VITE_API_URL`** | Vite dev-server proxy target in `app/vite.config.js` (default `http://localhost:3000`). Not used by the Docker image. |
