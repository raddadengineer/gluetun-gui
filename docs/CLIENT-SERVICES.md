# Client services (traffic through Gluetun)

Applications that should **use the VPN** should send their outbound traffic **through the Gluetun network namespace**, not through the GUI container.

## Recommended: `network_mode: service:gluetun`

In Compose, attach the client service to the VPN container’s network stack:

```yaml
services:
  gluetun:
    image: qmcgaw/gluetun:latest
    container_name: gluetun
    # cap_add, devices, ports ...

  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    network_mode: "service:gluetun"
    depends_on:
      - gluetun
    environment:
      - PUID=1000
      - PGID=1000
    volumes:
      - ./qbittorrent-config:/config
```

- **Published ports** for the client are usually declared on **`gluetun`** (since that is the service that owns the network namespace listeners).
- The GUI’s **Settings → This app** includes a **compose snippet** helper; the API **`GET /api/compose-snippet`** (authenticated) returns a YAML fragment with the correct **`network_mode`** for your running engine container name.

## Alternative: HTTP/SOCKS proxy

Gluetun can expose an **HTTP proxy** and **Shadowsocks** on configured ports. Clients that support HTTP/SOCKS can point at **`gluetun:8888`** (or your mapped host port) **without** `network_mode: service:gluetun`. This is simpler for some apps but does **not** force all traffic through the tunnel unless the app cooperates.

## What not to do

- Do **not** set **`network_mode: service:gluetun-gui`** for download clients — the GUI container is not the VPN tunnel.
- Do **not** rely on **`depends_on`** alone for routing; **`network_mode`** (or explicit proxy settings) defines where packets go.

## Extending published ports

If you add services behind `network_mode: service:gluetun`, publish their listening ports on the **`gluetun`** service’s **`ports:`** list so the host can reach them.

## See also

- **[DOCKER.md](DOCKER.md)** — base compose and volumes.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the GUI recreates Gluetun and merges env.
