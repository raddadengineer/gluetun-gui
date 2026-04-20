# Environment reference

Variables fall into two groups:

1. **Container env** — set on the **`gluetun-gui`** service in Compose (or `docker run -e`). Read at **process startup** by Node.
2. **`gui-config.env`** — written by the **Settings** UI and the config API. Includes **`GUI_*`** keys and **all Gluetun VPN/env** keys the app merges into the engine container on save.

## Container-only (GUI process)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| **`DATA_DIR`** | Recommended | _(unset)_ | Directory for `gui-config.env`, `sessions.json`, `wireguard/`, backups, homelab state, etc. |
| **`JWT_SECRET`** | Recommended in prod | built-in dev secret | HMAC secret for issued JWTs. |
| **`JWT_EXPIRES_IN`** | No | `24h` | JWT lifetime (e.g. `12h`, `7d`). |

If **`DATA_DIR`** is unset, legacy paths under `server/` may be used — prefer **`DATA_DIR=/data`** plus a volume mount.

## `gui-config.env` — not passed into Gluetun (GUI / PIA helpers)

The server keeps these keys in **`gui-config.env`** but **removes** them from the env object used to **create** the `gluetun` container (they are for the UI, PIA automation, or app-only behavior). Gluetun still receives the normal **`VPN_*`**, **`OPENVPN_*`**, **`WIREGUARD_*`**, etc., produced from your settings.

### `GUI_*` (app / homelab)

| Key | Purpose |
| --- | --- |
| **`GUI_PASSWORD`** | Login password for the web UI. If unset, default login password **`gluetun-admin`** applies. |
| **`GUI_NOTIFY_WEBHOOK_URL`** | Optional HTTPS URL for outbound JSON webhook POSTs (monitor events). |
| **`GUI_NOTIFY_WEBHOOK_SECRET`** | Optional `Authorization: Bearer …` value for webhooks. |
| **`GUI_NOTIFY_QUIET_ENABLED`** | `on` / `true` to enable server-side quiet hours for webhooks. |
| **`GUI_NOTIFY_QUIET_START`** | Quiet window start, **`HH:MM`** (default `22:00`). |
| **`GUI_NOTIFY_QUIET_END`** | Quiet window end, **`HH:MM`** (default `07:00`). |
| **`GUI_BACKUP_INTERVAL_HOURS`** | Hours between scheduled **`DATA_DIR`** backups; **`0`** disables. |
| **`GUI_BACKUP_RETENTION`** | Max backup archives to keep (clamped server-side). |
| **`GUI_DIFF_HISTORY_MAX`** | Max entries in **`config-diff-history.json`** (clamped **5–200**, default **30**). |

### `PIA_*` (stored for the UI; mapped before recreate)

| Key | Purpose |
| --- | --- |
| **`PIA_USERNAME`** / **`PIA_PASSWORD`** | PIA credentials in the UI; for **OpenVPN**, the server copies into **`OPENVPN_USER`** / **`OPENVPN_PASSWORD`** for Gluetun before stripping these keys. |
| **`PIA_REGIONS`** | Legacy / combined region helper text (see Settings). |
| **`PIA_WG_REGIONS`** / **`PIA_OPENVPN_REGIONS`** | Ordered region lists for WireGuard vs OpenVPN flows. |
| **`PIA_REGION_INDEX`** | Current failover index (monitor / rotation). |
| **`PIA_ROTATION_RETRIES`** / **`PIA_ROTATION_COUNT`** | Rotation bookkeeping used by the server. |

## Gluetun variables

Everything else stored in **`gui-config.env`** that is not in the `GUI_*` strip list is treated as **Gluetun configuration**: `VPN_SERVICE_PROVIDER`, `VPN_TYPE`, `SERVER_REGIONS`, PIA/OpenVPN/WireGuard keys, firewall, DNS, proxies, etc. Consult the **[Gluetun wiki](https://github.com/qdm12/gluetun-wiki)** for authoritative semantics.

## Secrets in exports

Exports and diff views **redact** known secret keys (including **`GUI_PASSWORD`** and **`GUI_NOTIFY_WEBHOOK_SECRET`**). Treat any full `gui-config.env` backup as **sensitive** regardless.
