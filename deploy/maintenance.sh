#!/usr/bin/env bash
# Switch maintenance mode on the live server on or off (no redeploy, takes effect immediately).
#
# Usage:   ./deploy/maintenance.sh on|off|status [user@vm-ip] [path-to-ssh-key]
# The server and key default to DEPLOY_TARGET and DEPLOY_KEY in deploy/.env.
#
# While on: the website shows deploy/maintenance/index.html, and the apps get "LisanCast is under maintenance".
# Both answer 503 with Retry-After, so search engines treat it as a temporary pause.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
[ -f "$ROOT/deploy/.env" ] && . "$ROOT/deploy/.env"
ACTION="${1:-}"
TARGET="${2:-${DEPLOY_TARGET:-}}"
KEY="${3:-${DEPLOY_KEY:-}}"
FLAG=/opt/live-translate/deploy/maintenance-flag/on

if [[ ! "$ACTION" =~ ^(on|off|status)$ ]] || [ -z "$TARGET" ] || [ -z "$KEY" ]; then
  sed -n '4,5p' "$0"
  exit 1
fi
KEY="${KEY/#\~/$HOME}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$TARGET")

case "$ACTION" in
  on) "${SSH[@]}" "mkdir -p $(dirname "$FLAG") && touch $FLAG" && echo "Maintenance mode is ON: visitors now see the maintenance page." ;;
  off) "${SSH[@]}" "rm -f $FLAG" && echo "Maintenance mode is OFF: LisanCast is back to normal." ;;
  status) "${SSH[@]}" "test -f $FLAG" && echo "Maintenance mode is ON." || echo "Maintenance mode is OFF." ;;
esac
