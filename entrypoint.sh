#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/app/data}"

# If running as root, ensure data directories exist and adjust ownership/permissions for appuser
if [ "$(id -u)" = "0" ]; then
    mkdir -p "$DATA_DIR/images" "$DATA_DIR/seed_photos"
    chown -R appuser:appuser "$DATA_DIR"
    chmod -R u+rwX,g+rwX,o+rwX "$DATA_DIR"
    exec gosu appuser "$@"
fi

exec "$@"
