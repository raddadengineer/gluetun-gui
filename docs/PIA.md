# Private Internet Access (PIA) in Gluetun-GUI

PIA is the most automated path in this UI: **WireGuard** (token + `pia-wg-config`) and **OpenVPN** (user/password + Gluetun region labels) both support **optional port forwarding** and **multi-region failover** when you configure ordered regions.

## WireGuard

- The UI stores PIA credentials and regions in **`gui-config.env`** and, on save, can run **`pia-wg-config`** to materialize **`wireguard/wg0.conf`** under **`DATA_DIR`**.
- **Port forwarding** is toggled in Settings; when enabled, the background monitor also checks PF health.
- **Failover** advances **`PIA_REGION_INDEX`** through your ordered region list, regenerates WireGuard material, and **recreates** Gluetun. Details: **[MONITORING.md](MONITORING.md)**.

WireGuard regions use the **PIA region API** style identifiers in the UI (not the same tokens as OpenVPN “region labels”).

### Port-forwarding capable regions (WireGuard)

PIA marks regions that support port forwarding in its server list. When **PIA port forwarding** is enabled:

- The UI will only show / keep **PF-capable** WireGuard regions (regions where `port_forward=true`).
- The server supports `GET /api/pia/regions?portForwardOnly=1` to return **only** PF-capable regions (used by the Settings “Refresh regions” action when PF is on).

### Why you may see `SERVER_NAMES` in logs

When port forwarding is enabled for **PIA WireGuard**, the GUI pins Gluetun to the **exact** PIA server selected by `pia-wg-config` by setting:

- `SERVER_NAMES=<server-common-name>`

This avoids port-forwarding flakiness that can happen if Gluetun selects a different server within the same region pool.

## OpenVPN

- Uses standard **PIA user + password** and Gluetun’s **`SERVER_REGIONS`** (and related) env vars.
- The UI maps **Gluetun region labels** from `servers.json` and can translate legacy **`server_name`** style tokens on load/save for older configs.
- With **port forwarding** on (`PIA_PORT_FORWARDING` / `VPN_PORT_FORWARDING`), the UI restricts choices to **PF-capable** OpenVPN regions where applicable.

## TLS fallback for PIA token generation (WireGuard)

Some environments can hit a TLS validation error against PIA’s legacy token endpoint:

- `x509: certificate relies on legacy Common Name field, use SANs instead`

When that happens, `pia-wg-config` automatically retries token generation via:

- `https://www.privateinternetaccess.com/api/client/v2/token`

If you instead see:

- `x509: certificate signed by unknown authority`

ensure the runtime image has a system CA bundle installed (Alpine: `ca-certificates`). The Dockerfile for this repo includes that.

## Port forwarding timeouts

If Gluetun logs timeouts calling:

- `https://10.237.128.1:19999/getSignature?...` with `context deadline exceeded`

that indicates Gluetun cannot reach PIA’s PF gateway through the tunnel at that moment (startup race, non-PF region/server, or firewall outbound restrictions). See **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** for the fast checks and suggested firewall allowlist.

## Failover list vs single region

- Maintain an **ordered list** of regions (WireGuard: API regions; OpenVPN: Gluetun labels) in Settings.
- The monitor’s **`executeFailoverRotation()`** uses **`PIA_REGION_INDEX`** and that list. **Dashboard → Test Auto-Failover** runs the same rotation for a dry run.

## Non-PIA providers

Failover rotation is **PIA-oriented**. For other providers, repeated failures typically result in a **container restart** rather than region rotation — see **[MONITORING.md](MONITORING.md)**.

## Further reading

- **[FEATURES.md](FEATURES.md)** — Settings tabs and PIA-related toggles.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — PIA OpenVPN mapping, API routes, persistence.
- Upstream **[Gluetun wiki](https://github.com/qdm12/gluetun-wiki)** for provider-specific env semantics.
