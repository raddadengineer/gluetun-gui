#!/bin/sh
# Entrypoint: ensure bind-mounted env files exist as files (not directories)
# before the server starts. Docker creates a directory for missing bind-mount
# targets — this prevents that silent breakage.

ensure_file() {
    if [ ! -e "$1" ]; then
        touch "$1"
        echo "[entrypoint] Created blank file: $1"
    elif [ -d "$1" ]; then
        rm -rf "$1"
        touch "$1"
        echo "[entrypoint] Replaced directory with blank file: $1"
    fi
}

ensure_file /usr/src/app/.env
ensure_file /gluetun.env

exec node index.js
