# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where version tags exist.

## [Unreleased]

### Documentation

- Added operator guides: troubleshooting, reverse proxy, PIA notes, environment reference, client stack patterns.
- Added `CONTRIBUTING.md`, `SECURITY.md`, and root `LICENSE` (ISC).

## [0.1.0] — 2026-04-19

Initial public documentation snapshot for the Docker-published stack.

### Highlights

- React + Vite UI with JWT auth; Express API and Docker socket orchestration.
- Settings aligned with Gluetun env; save-with-diff; PIA WireGuard / OpenVPN flows including region failover.
- Dashboard, network/session views, multiplexed logs (SSE), themes and notifications.
- Background VPN monitor, webhooks, optional `DATA_DIR` backups, config diff history, homelab status fields on `/api/status`.
