#!/bin/sh
#
# provision-openclaw.sh
#
# Registers the CMO and Blog Writer agents in OpenClaw.
# Idempotent — safe to run multiple times.  If an agent already exists
# the "add" command will fail and we simply skip it.
#
# Run inside the openclaw container:
#   docker compose exec openclaw sh /home/node/.openclaw/agents-config/../provision-openclaw.sh
# or from the host:
#   docker compose exec openclaw sh -c "$(cat docker/provision-openclaw.sh)"
#
set -e

AGENTS_DIR="/home/node/.openclaw/agents-config"
CLI="node dist/index.js"

register_agent() {
  name="$1"
  dir="$2"

  if [ ! -d "$dir" ]; then
    echo "[provision] WARNING: agent directory not found: $dir — skipping"
    return 0
  fi

  echo "[provision] Registering agent: $name ..."
  if $CLI agents add "$dir" --name "$name" --non-interactive --json 2>/dev/null; then
    echo "[provision] Agent '$name' registered successfully."
  else
    echo "[provision] Agent '$name' already exists or registration returned non-zero — skipping."
  fi
}

echo "[provision] Starting OpenClaw agent provisioning..."

register_agent "cmo"         "$AGENTS_DIR/cmo"
register_agent "blog-writer" "$AGENTS_DIR/blog-writer"

echo "[provision] Provisioning complete."
