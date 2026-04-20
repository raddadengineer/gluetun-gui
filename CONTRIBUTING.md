# Contributing

Thanks for helping improve Gluetun-GUI.

## Before you start

- Read **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for API and data flow.
- Do **not** commit real **passwords**, **PIA tokens**, **`JWT_SECRET`**, or production **`gui-config.env`** snippets. Use redacted examples in issues and PRs.

## Local development

1. **Backend** — From `server/`:
   ```bash
   npm install && node index.js
   ```
   Serves API and (after a frontend build) static files on port **3000** by default.

2. **Frontend** — From `app/` (second terminal):
   ```bash
   npm install && npm run dev
   ```
   Vite dev server (default **5173**) proxies `/api` to `http://localhost:3000` — see `app/vite.config.js`.

3. **Data** — Point **`DATA_DIR`** at a writable folder (e.g. `./data`) so `gui-config.env` and related files match production layout.

Default login when **`GUI_PASSWORD`** is unset: **`gluetun-admin`**.

## Pull requests

- Keep changes **focused** on one concern when possible.
- Match existing **formatting and naming** in touched files.
- If you change user-visible behavior, update **[README.md](README.md)** or the relevant file under **`docs/`** in the same PR.

## Tests

There is no automated test suite in-tree yet; manual smoke checks (login, Settings save, Dashboard, Logs stream) are appreciated in PR descriptions.

## License

By contributing, you agree your contributions are licensed under the same terms as the project — see **[LICENSE](LICENSE)** (ISC).
