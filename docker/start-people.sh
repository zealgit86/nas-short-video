#!/bin/sh
set -eu
if [ "${AUTH_ENABLED:-true}" = "true" ] && [ -z "${AUTH_SECRET:-}" ]; then
  echo 'Set AUTH_SECRET to a Caddy bcrypt password hash before starting.' >&2
  exit 1
fi
python3 /srv/people-api.py &
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
