# Gluetun GUI

A modern, Premium Glassmorphism control panel for your Gluetun VPN container.

## Features
- **Real-Time Dashboard**: Monitor container stats (CPU, RAM, Upload/Download bandwidth).
- **Settings Configurator**: Dynamically configure openvpn/wireguard settings, custom DNS blocks, and HTTP proxy rules via a unified state interface. 
- **Docker Logs Streaming**: View the full stdout/stderr of your Gluetun container securely through the browser.
- **Security**: fully tokenized JWT backend with access guard.

## Running Locally

To run the GUI during development without Docker:

```powershell
# Open powershell and execute the following from the `gui` directory:
Start-Process node -ArgumentList "index.js" -WorkingDirectory ".\server" -WindowStyle Hidden; cd app; npm run dev
```

## Running with Docker (Recommended)
You can build and run this GUI completely packaged in a Docker container using the provided `docker-compose.yml` located in the `gui` folder.
```bash
docker-compose up -d --build
```
