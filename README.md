# Gluetun-GUI

A beautiful, responsive, and data-driven graphical interface for managing your [Gluetun](https://github.com/qdm12/gluetun) VPN container. Built with React, Vite, and Express, this GUI allows you to monitor network traffic in real-time, configure settings across all major VPN providers, and manage your VPN tunnel directly from your browser.

## Features

- **Real-Time Dashboard**: Monitor CPU/RAM usage, network throughput, and connection status in an elegant React dashboard.
- **Auto-Failover for Private Internet Access (PIA)**: Seamless multi-region WireGuard auto-failover, with automatic key generation, port-forwarding support, and background session renewal.
- **Multiplexed Logs**: View real-time aggregated logs from both the Gluetun engine and the GUI securely in your browser.
- **Robust Settings Management**: Manage the complete Gluetun `.env` configuration—DNS over TLS, Adblock, Shadowsocks, HTTP proxies, kill switches, and more.
- **Docker Integrated**: Leverages the Docker socket to interact directly with the Gluetun container for instant restarts and config deployments without manual intervention.

## Quick Start

1. Create a directory for your VPN setup and ensure you have `docker-compose` installed.
2. Initialize the necessary files:
   ```bash
   touch gluetun.env gui-settings.env
   mkdir gluetun-config
   ```
3. Use the following `docker-compose.yml` file:

```yaml
services:
  gluetun:
    image: qmcgaw/gluetun:latest
    container_name: gluetun
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    env_file:
      - ./gluetun.env
    ports:
      - "8888:8888/tcp"  # HTTP proxy
      - "8388:8388/tcp"  # Shadowsocks
      - "8388:8388/udp"  # Shadowsocks

  gluetun-gui:
    image: raddadengineer/gluetun-gui:latest
    container_name: gluetun-gui
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./gui-settings.env:/usr/src/app/.env
      - ./gluetun-config:/config
      - ./gluetun.env:/gluetun.env
    depends_on:
      - gluetun
```

4. Bring up the containers:
   ```bash
   docker compose up -d
   ```
5. Access the GUI at `http://localhost:3000`. The default password is `gluetun-admin` (You can change this by adding `GUI_PASSWORD=your_new_password` to `gui-settings.env`).

## Architecture

The system consists of:
- **Gluetun Container**: Handles all VPN tunnel connections, firewall rules, routing, and DNS.
- **Gluetun-GUI Container**: An Express.js backend that serves a React frontend. The express backend communicates via Docker socket to orchestrate, analyze, and recreate the Gluetun container with updated configurations seamlessly.

## Advanced Configurations

For specific provider configuration guides, or advanced local networking with Proxies and Firewalls, use the **Settings** tab within the GUI to easily configure and deploy your changes.
