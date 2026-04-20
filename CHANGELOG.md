# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where version tags exist.

## [Unreleased]

### Documentation

- Added operator guides: troubleshooting, reverse proxy, PIA notes, environment reference, client stack patterns.
- Added `CONTRIBUTING.md`, `SECURITY.md`, and root `LICENSE` (ISC).

## [0.4.0] — 2026-04-20

This release focuses on day-to-day usability: dashboard customization, better notifications, richer network/log tooling, and hardening the PIA automation path.

### Added

- Dashboard widgets system with per-widget visibility, persistence, and a dedicated Settings section.
- Drag/resize dashboard layout with **Edit/Lock** mode (layout saved in the browser).
- Network Monitor UX improvements (live/pause, refresh interval, history controls) and per-interface visibility toggles.
- System Logs page enhancements including multi-select filters for **Sources** and **Level**, pause/buffer, and performance controls.
- About page version panel showing app version, latest changelog release, and build/commit metadata.
- `build.sh` helper to build (and optionally push) images with commit metadata baked in.

### Changed

- Notifications and toast system deduplication to prevent repeated popups for the same underlying event.
- Notification bell popover rendering to use a portal so it stays on top of widgets/sidebar and isn’t clipped.
- Sidebar navigation layout and styling for clearer grouping and active-route visibility.
- PIA WireGuard region list loading can be filtered to PF-capable regions when port forwarding is enabled.

### Fixed

- PIA WireGuard token generation: on legacy-CN TLS failures, automatically retry via `https://www.privateinternetaccess.com/api/client/v2/token`.
- PIA WireGuard token fallback TLS trust: use system roots (and ensure runtime image includes `ca-certificates`) to avoid `unknown authority`.
- Network metrics interface completeness: include tunnel interfaces (e.g. `tun0`) by enriching Docker stats with `/proc/net/dev`.
- Port-forward monitoring false negatives when Gluetun control server endpoints return auth errors (avoid counting as failures when PF status cannot be read).

### Documentation

- Expanded PIA docs (PF-only region filtering, `SERVER_NAMES` pinning, token TLS fallback) and troubleshooting for PF gateway timeouts.

## [0.1.0] — 2026-04-19

Initial public documentation snapshot for the Docker-published stack.

### Highlights

- React + Vite UI with JWT auth; Express API and Docker socket orchestration.
- Settings aligned with Gluetun env; save-with-diff; PIA WireGuard / OpenVPN flows including region failover.
- Dashboard, network/session views, multiplexed logs (SSE), themes and notifications.
- Background VPN monitor, webhooks, optional `DATA_DIR` backups, config diff history, homelab status fields on `/api/status`.
