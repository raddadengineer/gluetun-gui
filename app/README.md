# Gluetun-GUI — frontend (`app/`)

Vite + React SPA. Production build output is emitted to **`../server/public`** (see root `Dockerfile` / Vite config).

## Prerequisites

- Node 18+ (or current LTS)
- Running **Express API** from **`../server`** on port **3000** (or set Vite proxy target if you change ports)

## Develop locally

From the **repository root**:

```bash
cd server && node index.js &
cd ../app && npm install && npm run dev
```

Or two terminals: one with `node index.js` in `server/`, one with `npm run dev` in `app/`.

- Dev server: Vite default **http://localhost:5173** (proxies `/api` to the backend — see `vite.config.js`).
- Log in with the same password as **`GUI_PASSWORD`** in `gui-config.env` (default **`gluetun-admin`** if unset).

## Build for production

```bash
cd app && npm install && npm run build
```

Commit or copy the generated **`server/public/`** tree as required by your deploy path.

## Stack (high level)

- **React Router** — `/`, `/logs`, `/network`, `/settings`, `/about`, `/login`
- **`ThemeContext`** — `data-theme` + `localStorage`
- **`NotificationsContext`** — bell, list, toasts, prefs in `localStorage`
- **Recharts** — Dashboard throughput
- **date-fns** — Relative times

**Settings** (`pages/Settings.jsx`) uses tabs: **VPN & tunnel**, **Firewall & ports** (includes `DNS_UPSTREAM_IPV6` / IPv6 upstream DNS toggle mirrored with the DNS tab), **DNS & blocklists**, **Local proxies**, **This app**, **Gluetun advanced** — all values POST to **`/api/config`** except export/import, which use dedicated routes.

For setup and operator topics, start with **`../docs/README.md`**. For Docker, env vars, client stacks, PIA, monitoring, reverse proxy, and troubleshooting, see **`../docs/DOCKER.md`**, **`../docs/ENVIRONMENT.md`**, **`../docs/CLIENT-SERVICES.md`**, **`../docs/PIA.md`**, **`../docs/MONITORING.md`**, **`../docs/REVERSE-PROXY.md`**, **`../docs/TROUBLESHOOTING.md`**, and **`../docs/OPERATIONS.md`**. For diagrams and route tables, read **`../docs/ARCHITECTURE.md`**. Contributing and security: **`../CONTRIBUTING.md`**, **`../SECURITY.md`**.
