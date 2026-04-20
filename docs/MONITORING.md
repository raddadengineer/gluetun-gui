# Monitor and auto-failover

The GUI server runs a **background monitor** (`checkVPN`) against the **Gluetun engine** container (not the GUI container).

1. **Intervals** — When checks are passing, the loop runs about every **15 minutes** (`HEALTHY_INTERVAL`). When **VPN connectivity** or **VPN port forwarding** checks are failing, it runs about every **1 minute** (`CHECK_INTERVAL`) until healthy again.
2. **Warm-up** — After the engine container starts, connectivity failures are **not counted** toward failover for **~25s** (WireGuard) or **~120s** (OpenVPN), so brief bring-up noise does not trigger rotation.
3. **What is checked** — Outbound **public IP** is resolved from **inside** Gluetun (Gluetun control HTTP, then HTTPS/plain fallbacks). If **VPN port forwarding** is enabled in the saved GUI config (`VPN_PORT_FORWARDING=on` or `PIA_PORT_FORWARDING=on|true`), the monitor also tries Gluetun’s **port-forward** endpoint (or a status file fallback) and tracks **PF failure streaks** separately from **VPN failure streaks**.
4. **Threshold** — If **either** streak reaches **3** consecutive failures (`FAIL_THRESHOLD`), the server logs **persistent failure**, may send **webhooks** (`vpn_connectivity_failed` and/or `port_forwarding_failed`), then runs **`executeFailoverRotation()`**.
5. **Failover rotation (PIA-oriented)** — Reads **`PIA_REGION_INDEX`** and the ordered region lists from `gui-config.env`:
   - **WireGuard** with PIA credentials: advances index, updates `gui-config.env`, runs **`pia-wg-config`** for the next region, then recreates Gluetun with the new WireGuard material.
   - **OpenVPN + Private Internet Access:** maps the next token to a canonical **Gluetun `SERVER_REGIONS`** label (with PF validation when PF is on), then **`recreateGluetunContainer`** with that `SERVER_REGIONS` value.
   - **No regions / non-PIA paths / errors:** falls back to **restarting** the existing Gluetun container (`restart`) so traffic recovers when rotation logic does not apply.
6. **Manual test** — **Dashboard → Quick Actions → Test Auto-Failover** calls **`POST /api/test-failover`**, which runs the **same** `executeFailoverRotation()` (useful to verify ordering without waiting for failures).

Webhooks are **throttled per event type** (and `gluetun_container_missing` is limited to once per 5 minutes) to avoid storms during flapping.

Webhook URLs and quiet hours are configured in the UI under **Settings → This app**; see [OPERATIONS.md](OPERATIONS.md) for environment variable names. PIA-specific UI fields: **[PIA.md](PIA.md)**.

## Port forwarding failures (PIA)

When port forwarding is enabled, Gluetun may log startup errors like:

- `starting port forwarding service: ... getSignature ... context deadline exceeded`

This means Gluetun timed out calling PIA’s port-forward gateway through the tunnel. Common causes:

- The selected region/server is not PF-capable
- A startup race (tunnel not fully ready yet)
- Firewall/outbound restrictions preventing traffic to the PF gateway subnet

If you run Gluetun with firewall restrictions, ensure outbound allows the PF gateway range (commonly `10.237.128.0/24`). See **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** for quick checks.
