# Private Internet Access (PIA) in Gluetun-GUI

PIA is the most automated path in this UI: **WireGuard** (token + `pia-wg-config`) and **OpenVPN** (user/password + Gluetun region labels) both support **optional port forwarding** and **multi-region failover** when you configure ordered regions.

## WireGuard

- The UI stores PIA credentials and regions in **`gui-config.env`** and, on save, can run **`pia-wg-config`** to materialize **`wireguard/wg0.conf`** under **`DATA_DIR`**.
- **Port forwarding** is toggled in Settings; when enabled, the background monitor also checks PF health.
- **Failover** advances **`PIA_REGION_INDEX`** through your ordered region list, regenerates WireGuard material, and **recreates** Gluetun. Details: **[MONITORING.md](MONITORING.md)**.

WireGuard regions use the **PIA region API** style identifiers in the UI (not the same tokens as OpenVPN “region labels”).

## OpenVPN

- Uses standard **PIA user + password** and Gluetun’s **`SERVER_REGIONS`** (and related) env vars.
- The UI maps **Gluetun region labels** from `servers.json` and can translate legacy **`server_name`** style tokens on load/save for older configs.
- With **port forwarding** on (`PIA_PORT_FORWARDING` / `VPN_PORT_FORWARDING`), the UI restricts choices to **PF-capable** OpenVPN regions where applicable.

## Failover list vs single region

- Maintain an **ordered list** of regions (WireGuard: API regions; OpenVPN: Gluetun labels) in Settings.
- The monitor’s **`executeFailoverRotation()`** uses **`PIA_REGION_INDEX`** and that list. **Dashboard → Test Auto-Failover** runs the same rotation for a dry run.

## Non-PIA providers

Failover rotation is **PIA-oriented**. For other providers, repeated failures typically result in a **container restart** rather than region rotation — see **[MONITORING.md](MONITORING.md)**.

## Further reading

- **[FEATURES.md](FEATURES.md)** — Settings tabs and PIA-related toggles.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — PIA OpenVPN mapping, API routes, persistence.
- Upstream **[Gluetun wiki](https://github.com/qdm12/gluetun-wiki)** for provider-specific env semantics.
