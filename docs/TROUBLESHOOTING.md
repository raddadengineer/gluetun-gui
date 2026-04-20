# Troubleshooting

## Docker socket / “Cannot connect to Docker”

The GUI container must mount **`/var/run/docker.sock`** with permissions the **node process** can use.

- **Permission denied** on the socket: on Linux, the user inside the image must be able to read/write the socket file. Common fixes: run the stack as root (default for many Hub images), or align host socket GID with the container user (advanced).
- **Wrong path:** use `/var/run/docker.sock`, not a path inside `data/`.

Mounting the socket gives the GUI **full Docker control on that host** — only run it where that is acceptable.

## Engine container not found

The API looks up the VPN container with **`findGluetunEngineContainer()`**:

1. Prefer a container whose name is exactly **`/gluetun`** (Compose `container_name: gluetun`).
2. Otherwise the first name matching **`gluetun`** but **not** containing **`gui`**.

If you rename the VPN service oddly (e.g. only `my-vpn`), the GUI may pick the wrong container or none. **Recommendation:** keep **`container_name: gluetun`** as in the sample [`docker-compose.yml`](../docker-compose.yml).

## `DATA_DIR` / missing config

- Set **`DATA_DIR=/data`** (or your path) and mount a host folder at **`/data`** so `gui-config.env` persists.
- If **`DATA_DIR`** is unset, the server falls back to legacy paths; prefer an explicit `DATA_DIR` for new installs. See **[OPERATIONS.md](OPERATIONS.md)**.

## Login / JWT issues

- **Wrong password:** default is **`gluetun-admin`** until **`GUI_PASSWORD`** is set in `gui-config.env` or Settings.
- **`JWT_SECRET` changed:** existing browser tokens become invalid; log in again. Set a stable secret in production — see **[OPERATIONS.md](OPERATIONS.md)**.
- **401 on `/api/*`:** ensure you completed login and the UI still has a valid token (`localStorage`); try a private window to rule out stale state.

## UI loads but Logs never stream

Live logs use **Server-Sent Events** on **`GET /api/logs`**. If you put a **reverse proxy** in front of the GUI, it must allow long-lived chunked/SSE responses — see **[REVERSE-PROXY.md](REVERSE-PROXY.md)**.

## VPN stuck “connecting” or monitor always failing

- **Warm-up:** after a container start, the monitor intentionally ignores short failures (WireGuard ~25s, OpenVPN ~120s). Wait before assuming a bug.
- **PIA / credentials:** confirm provider, user/password or WireGuard keys, and region lists in **Settings → VPN & tunnel**.
- **Gluetun healthcheck loops:** see the [Gluetun healthcheck FAQ](https://github.com/qdm12/gluetun-wiki/blob/main/faq/healthcheck.md) (linked from Settings where relevant).

## PIA port forwarding: `getSignature` timeout (`context deadline exceeded`)

If Gluetun logs an error like:

- `starting port forwarding service: ... Get "https://10.237.128.1:19999/getSignature?...": context deadline exceeded`

it means Gluetun could not reach PIA’s port-forward gateway through the VPN tunnel in time.

Fast checks:

- **PF-capable region:** ensure the selected PIA region supports port forwarding (prefer CA/EU regions; many US-state labels lack PF servers).
- **Pinned server name (WireGuard):** with PF on, the GUI may set `SERVER_NAMES=Server-...` to keep Gluetun on the exact PF-capable server selected by `pia-wg-config` (expected).
- **Firewall/outbound rules:** if you use Gluetun firewall restrictions, allow the PF gateway subnet:
  - `FIREWALL_OUTBOUND_SUBNETS=10.237.128.0/24` (typical)
  - or broader `FIREWALL_OUTBOUND_SUBNETS=10.0.0.0/8` if you prefer simplicity
- **Startup race:** if this only happens immediately after boot, a single Gluetun restart after the tunnel is up often clears it.

## PIA WireGuard token fallback TLS errors

If `pia-wg-config` logs:

- `certificate relies on legacy Common Name field, use SANs instead`

it will retry against the public token endpoint. If the retry fails with:

- `certificate signed by unknown authority`

the runtime environment likely lacks system root CAs (Alpine: install `ca-certificates`). This repo’s `Dockerfile` includes that package.

## Save / recreate errors

- **Diff modal never completes:** check browser console and **`docker compose logs gluetun-gui`** for API errors.
- **Docker API errors during recreate:** disk full, image pull failures, or port conflicts on the host can block `createContainer`. Inspect **`docker compose logs gluetun`** and **`gluetun-gui`**.

## Still stuck

Collect **`docker compose logs gluetun-gui`**, **`docker compose logs gluetun`** (redact secrets), and open an issue with compose layout (no passwords).
