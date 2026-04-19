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

- **React Router** — `/`, `/logs`, `/network`, `/settings`, `/login`
- **`ThemeContext`** — `data-theme` + `localStorage`
- **`NotificationsContext`** — bell, list, toasts, prefs in `localStorage`
- **Recharts** — Dashboard throughput
- **date-fns** — Relative times

For full system behavior (Docker, monitoring, PIA, export/import), read **`../docs/ARCHITECTURE.md`**.
