#!/usr/bin/env bash
# Upload dist/ to shared hosting (Namecheap cPanel now, ALL-INKL later) over SFTP or FTPS.
#
# Follows docs/deployment.md: upload into a sibling "next" directory, then optionally swap it
# with "current" and keep the old release as "previous-<timestamp>" for rollback.
#
# Required environment variables:
#   DEPLOY_HOST       e.g. server123.web-hosting.com
#   DEPLOY_USER       hosting (S)FTP user
#   DEPLOY_PASSWORD   password (or leave empty and use an SSH key with sftp)
#   DEPLOY_ROOT       remote directory that holds current/ next/, e.g. brain.okdaily.net
# Optional:
#   DEPLOY_PROTOCOL   sftp (default) or ftps
#   DEPLOY_PORT       defaults to 22 for sftp and 21 for ftps
#
# Usage:
#   scripts/deploy.sh --dry-run     show what would be uploaded
#   scripts/deploy.sh               upload dist/ into DEPLOY_ROOT/next
#   scripts/deploy.sh --activate    upload, then swap next -> current (keeps previous-<ts>)
set -euo pipefail

cd "$(dirname "$0")/.."

dry_run=false
activate=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --activate) activate=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

: "${DEPLOY_HOST:?Set DEPLOY_HOST}"
: "${DEPLOY_USER:?Set DEPLOY_USER}"
: "${DEPLOY_ROOT:?Set DEPLOY_ROOT}"
protocol="${DEPLOY_PROTOCOL:-sftp}"
case "$protocol" in
  sftp) port="${DEPLOY_PORT:-22}" ;;
  ftps) port="${DEPLOY_PORT:-21}" ;;
  *) echo "DEPLOY_PROTOCOL must be sftp or ftps" >&2; exit 2 ;;
esac

command -v lftp >/dev/null || { echo "lftp is required (apt install lftp / brew install lftp)" >&2; exit 1; }

if [[ ! -f dist/index.html || ! -f dist/.htaccess ]]; then
  echo "dist/ is missing or incomplete. Run: npm run check" >&2
  exit 1
fi

if grep -q '__SUPABASE_' dist/.htaccess; then
  echo "dist/.htaccess still contains a CSP placeholder; rebuild with .env.local present." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%d-%H%M%S)"
mirror_flags="--reverse --delete --verbose --parallel=4 --exclude-glob .DS_Store"
$dry_run && mirror_flags="$mirror_flags --dry-run"

if [[ "$protocol" == "ftps" ]]; then
  url="ftp://$DEPLOY_HOST:$port"
  protocol_settings="set ftp:ssl-force true
set ftp:ssl-protect-data true
set ssl:verify-certificate yes"
else
  url="sftp://$DEPLOY_HOST:$port"
  protocol_settings="set sftp:auto-confirm no"
fi

# The password is passed through the environment (LFTP_PASSWORD + --env-password), never argv
# or the command file.
export LFTP_PASSWORD="${DEPLOY_PASSWORD:-}"
open_flags="-u $DEPLOY_USER"
[[ -n "$LFTP_PASSWORD" ]] && open_flags="--env-password $open_flags"

command_file="$(mktemp)"
trap 'rm -f "$command_file"' EXIT

{
  echo "set cmd:fail-exit yes"
  echo "set net:max-retries 2"
  echo "set net:timeout 30"
  echo "$protocol_settings"
  echo "open $open_flags $url"
  $dry_run || echo "mkdir -p -f $DEPLOY_ROOT/next"
  echo "mirror $mirror_flags dist/ $DEPLOY_ROOT/next/"
  if $activate && ! $dry_run; then
    echo "mv $DEPLOY_ROOT/current $DEPLOY_ROOT/previous-$stamp"
    echo "mv $DEPLOY_ROOT/next $DEPLOY_ROOT/current"
  fi
  echo "bye"
} > "$command_file"

lftp -f "$command_file"

if $dry_run; then
  echo "Dry run complete. Nothing was changed."
elif $activate; then
  echo "Activated. Previous release kept at $DEPLOY_ROOT/previous-$stamp (rename back to roll back)."
else
  echo "Uploaded to $DEPLOY_ROOT/next. Re-run with --activate, or swap the folders in cPanel."
fi
