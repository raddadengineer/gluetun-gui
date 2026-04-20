# Reverse proxy (HTTPS in front of the GUI)

The app listens on **port 3000** inside the **`gluetun-gui`** container. For anything beyond a trusted LAN, terminate **TLS** at a reverse proxy (Caddy, nginx, Traefik, etc.) and forward to that port.

## What must work through the proxy

| Traffic | Path | Notes |
| --- | --- | --- |
| **REST + login** | `/api/*` | Normal HTTP; set reasonable body/time limits. |
| **Live logs (SSE)** | **`/api/logs`** | **Server-Sent Events**, long-lived response. Disable response buffering and allow long read timeouts. |

The Logs page opens **`EventSource('/api/logs?…')`**. If the proxy **buffers** the whole response or **times out** quickly, the UI will look broken or lag badly.

## nginx (example)

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name gluetun-gui.example.com;

    # ssl_certificate ... ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE / streaming
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Point **`proxy_pass`** at your Docker-published host port (e.g. `http://127.0.0.1:3000` if you map `3000:3000`).

## Caddy (sketch)

```caddy
gluetun-gui.example.com {
    reverse_proxy localhost:3000 {
        flush_interval -1
    }
}
```

`flush_interval -1` helps streaming backends; verify against your Caddy version docs.

## Traefik

Use a **long** **`respondingTimeouts.readTimeout`** (or service-level idle timeout) for the route that serves this app, and avoid middlewares that buffer responses for **`/api/logs`**.

## WebSockets

This app does **not** use WebSockets for its main API; **SSE** on `/api/logs` is the special case.

## JWT and HTTPS

Set **`JWT_SECRET`** on the GUI container in production. Cookies are not used for API auth in the default flow (Bearer token in `localStorage`); HTTPS still protects credentials in transit and reduces token leakage to network attackers.

More on secrets and APIs: **[OPERATIONS.md](OPERATIONS.md)**.
