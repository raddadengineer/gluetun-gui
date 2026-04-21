# Operations

## Password and export/import

- **Default login password:** **`gluetun-admin`**, used when **`GUI_PASSWORD`** is not set in `gui-config.env`. Change it under **Settings → This app**, or set **`GUI_PASSWORD=...`** in `gui-config.env` (then save or restart the GUI container as needed).
- **Export / import** (same tab): download `.env` (optional redacted import-safe copy); **import** replaces saved config and recreates Gluetun — confirm in the UI.

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
- **Startup autostart:** A few seconds after the GUI API starts, if **`gui-config.env`** looks like a complete VPN profile but the **Gluetun engine container is not running**, the server runs the same **apply** pipeline as **Save** (recreate/start Gluetun), waits briefly, then runs the same **outbound connectivity probe** as **Save & connect** and updates **`vpn-connectivity-state.json`**. Disable with **`GUI_AUTOSTART_GLUETUN=off`** (also `false`, `0`, `no`) on the **gluetun-gui** container.

## Persisted files (`DATA_DIR`)

| Path | Role |
| --- | --- |
| `gui-config.env` | Authoritative GUI + VPN settings |
| `gluetun.env` | Last env passed into Gluetun |
| `sessions.json` | Session / bandwidth history |
| `wireguard/` | PIA WireGuard material when applicable |
| `vpn-connectivity-state.json` | Last **Test VPN connectivity** / Save & connect probe, or post-startup autostart probe |
| `gui-homelab-state.json` | Operator timestamps (monitor, webhooks, backups, …) |
| `config-diff-history.json` | Redacted env diffs after saves (cap `GUI_DIFF_HISTORY_MAX`, default 30) |
| `backups/*.tar.gz` | Optional scheduled or manual archives |

## Legacy migration

If older layouts used `server/.env` or `sessions.json` next to the server only, enabling **`DATA_DIR`** migrates those files into `./data` on first start.

## Security and automation

- **JWT signing:** Set **`JWT_SECRET`** (and optionally **`JWT_EXPIRES_IN`**, e.g. `12h` or `7d`) on the **gluetun-gui** container environment. If unset, a built-in development default is used (tokens survive image rebuilds until expiry).
- **TLS:** Put the GUI behind a reverse proxy with HTTPS for anything beyond a trusted LAN. See **[REVERSE-PROXY.md](REVERSE-PROXY.md)** (including **SSE** for `/api/logs`).
- **Save confirmation:** **Settings → Save** opens a diff of `gui-config.env` keys (secrets redacted) before recreating Gluetun.
- **Outbound webhooks:** Optional **`GUI_NOTIFY_WEBHOOK_URL`** receives JSON POSTs for monitor events (`gluetun_container_missing`, `vpn_connectivity_failed`, `vpn_connectivity_recovered`, `port_forwarding_failed`). Optional **`GUI_NOTIFY_WEBHOOK_SECRET`** is sent as `Authorization: Bearer …`. Optional **quiet hours** (server clock): **`GUI_NOTIFY_QUIET_ENABLED`** (`on`/`true`), **`GUI_NOTIFY_QUIET_START`**, **`GUI_NOTIFY_QUIET_END`** (`HH:MM`) — no webhook POSTs are sent during that window.
- **VPN check history:** Manual **Test VPN connectivity** (Dashboard or **Save & connect**) is stored under **`DATA_DIR/vpn-connectivity-state.json`** and shown on the overview.
- **Image hint:** For Docker Hub–style image names, the API compares the running digest to the registry manifest (best-effort; GHCR/private registries are skipped).
- **Save response:** **`POST /api/config`** (and import) can return **`containerDiff`** (redacted key-by-key delta for the next Gluetun env file vs the previous `gluetun.env` snapshot) and **`guiChangeCount`** for tooling.
- **Config diff history:** After each successful save, redacted GUI env diffs are appended to **`DATA_DIR/config-diff-history.json`**. **`GET /api/config/diff-history`** returns entries for the Settings viewer.
- **Data backups:** **`GUI_BACKUP_INTERVAL_HOURS`** (0 = off), **`GUI_BACKUP_RETENTION`**. Scheduled and **`POST /api/homelab/backup-run`** write **`DATA_DIR/backups/*.tar.gz`**. **`GET /api/homelab/backups`** lists archives.
- **Gluetun control proxy (authenticated):** **`GET /api/gluetun-control?path=/v1/...`** runs `wget` inside the engine container against `http://127.0.0.1:8000` (path must match `/v1/...`).
- **Compose snippet:** **`GET /api/compose-snippet`** returns a minimal YAML fragment for a **client** service using `network_mode: "service:<gluetun-container-name>"`, with optional port-binding hints from the running engine inspect.
- **`GET /api/status`** includes a **`homelab`** object (from **`gui-homelab-state.json`**) with timestamps for monitor ticks, last webhook attempt, last config save, last backup, etc., for scripts or future UI.

For route-level detail, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.
