# Features

PIA-focused behavior (WireGuard vs OpenVPN, failover): **[PIA.md](PIA.md)**.

- **Dashboard** — Connection state, provider label (GUI vs container), protocol, **server label** when available, CPU/RAM, throughput chart, **last manual VPN connectivity check**, monitoring (connectivity + **VPN port forwarding** when enabled). Quick actions: restart, **test VPN connectivity**, test failover, stop. (Gluetun engine image/digest details live under **Settings → This app** and **About**.)
- **Network** — Tunnel vs LAN traffic, per-interface stats, session peaks; **session history CSV export**.
- **Session history** — Bandwidth and metadata across container restarts (`sessions.json`).
- **Logs** — SSE multiplex of Gluetun + GUI process logs; filter and severity styling (theme-aware); **download** and **copy visible** snapshots; stream mode **last N lines + follow** or **from now (live only)** via query params.
- **Sidebar** — On **narrow viewports (≤900px)** the nav becomes a **collapsible drawer** (menu button, backdrop, Escape to close). On wider screens the sidebar can be **collapsed** and the choice is **remembered** (`localStorage`).
- **Settings** — Tabbed editor aligned with Gluetun env vars (save runs a **diff confirmation** before recreating Gluetun):
  - **VPN & tunnel** — Provider, WireGuard/OpenVPN, **PIA** WireGuard (regions, generate keys, **Port Forwarding** toggle) or **PIA OpenVPN** (credentials, **same Port Forwarding toggle**, **region labels** for `SERVER_REGIONS`, failover list, protocol/version; not WireGuard API region IDs). **Other providers:** server filters stay visible; **WireGuard-only** and **OpenVPN-only** blocks follow **VPN Type** (same pattern as PIA).
  - **Firewall & ports** — `FIREWALL_*` (outbound subnets, VPN/input ports, iptables log level), **IPv6** for upstream DNS (`DNS_UPSTREAM_IPV6`, mirrored with DNS tab), VPN port forwarding (`VPN_PORT_FORWARDING_*`).
  - **DNS & blocklists** — Resolvers, filtering toggles, blocklists, **IPv6 DNS** (same `DNS_UPSTREAM_IPV6` as Firewall tab).
  - **Local proxies** — Shadowsocks, HTTP proxy.
  - **This app** — **Theme**, **GUI password**, **notifications** (bell + toasts, optional **local quiet hours**), **Save all changes** and **Save & connect** (after a successful save, runs the same outbound VPN probe as Dashboard), **backup/export/import** of `gui-config.env`, **scheduled `DATA_DIR` backups** (`.tar.gz` under `backups/`), **compose client snippet** (copy `network_mode: service:gluetun`), **config diff history** viewer, **outbound webhooks** (with optional **server-side quiet hours**), **search** to filter fields on the active tab.
  - **Gluetun advanced** — Logging, health check, updater, system/public IP options, VPN hooks.
- **About** — App version, latest changelog release (from `CHANGELOG.md` in the image), build/commit metadata (`GET /api/about`), and links to upstream docs.
- **PIA automation** — WireGuard via `pia-wg-config`; multi-region **auto-failover** and optional port forwarding (when PF is on, region lists can be restricted to **PF-capable** PIA regions). OpenVPN uses Gluetun **region** labels from `servers.json`, maps legacy **`server_name`** tokens on load/save, and when **port forwarding** is on (`PIA_PORT_FORWARDING` or `VPN_PORT_FORWARDING`) only **PF-capable** OpenVPN regions are kept or listed.
- **Notifications** — In-app bell, deduped events (save, monitor, dashboard actions, log warnings), configurable sources and toast levels (`localStorage`).
- **Themes** — Card-based picker under **Settings → This app**; several dark, light, and high-readability palettes (`localStorage` key `gluetun_gui_theme_v1`). UI font tuned for on-screen reading (**Inter**).
- **Docker** — Recreate Gluetun with merged env on every save/import; engine container resolved reliably (name `gluetun`, not `gluetun-gui`).

## Supported providers (Gluetun)

AirVPN · CyberGhost · ExpressVPN · FastestVPN · Giganews · HideMyAss · IPVanish · IVPN · Mullvad · NordVPN · Perfect Privacy · Privado · **Private Internet Access** · PrivateVPN · ProtonVPN · PureVPN · SlickVPN · Surfshark · TorGuard · VPN Secure · VPN Unlimited · Vyprvpn · Windscribe · **Custom** (OpenVPN / WireGuard).
