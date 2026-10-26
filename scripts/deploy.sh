#!/usr/bin/env bash
# Upload dist/ straight into the subdomain document root (Namecheap cPanel now, ALL-INKL later)
# over SFTP or FTPS with lftp. See docs/deployment.md.
#
# Before every upload the live files are backed up:
#   1. downloaded to deploy-backups/<UTC timestamp>/ on this machine (always; git-ignored), and
#   2. copied to $DEPLOY_BACKUP_ROOT/<timestamp>/ on the server, outside the document root
#      (skip with --no-remote-backup).
#
# Required environment variables:
#   DEPLOY_HOST          e.g. server123.web-hosting.com
#   DEPLOY_USER          hosting (S)FTP user
#   DEPLOY_ROOT          the document root, e.g. brain.okdaily.net
# Optional:
#   DEPLOY_PASSWORD      password (leave empty to use an SSH key with sftp)
#   DEPLOY_PROTOCOL      sftp (default) or ftps
#   DEPLOY_PORT          defaults to 22 for sftp and 21 for ftps
#   DEPLOY_BACKUP_ROOT   remote backup folder outside the doc root (default: brain-backups)
#
# Usage:
#   scripts/deploy.sh --dry-run            show what would be uploaded; changes nothing
#   scripts/deploy.sh                      back up, then upload new/changed files
#   scripts/deploy.sh --delete             ...and also delete stale files the build no longer has
#   scripts/deploy.sh --rollback DIR       back up, then restore DIR (e.g. deploy-backups/<ts>)
#                                          exactly, including deleting files not in DIR
#   --no-remote-backup                     keep only the local backup
#
# Server-managed paths are never deleted: .well-known/ (SSL validation), cgi-bin/, .user.ini,
# php.ini and error_log.
set -euo pipefail

cd "$(dirname "$0")/.."

dry_run=false
delete=false
remote_backup=true
source_dir="dist"
rollback=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --delete) delete=true ;;
    --no-remote-backup) remote_backup=false ;;
    --rollback)
      [[ $# -ge 2 ]] || { echo "--rollback needs a backup folder" >&2; exit 2; }
      source_dir="${2%/}"
      rollback=true
      delete=true
      shift
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

: "${DEPLOY_HOST:?Set DEPLOY_HOST}"
: "${DEPLOY_USER:?Set DEPLOY_USER}"
: "${DEPLOY_ROOT:?Set DEPLOY_ROOT}"
backup_root="${DEPLOY_BACKUP_ROOT:-brain-backups}"
protocol="${DEPLOY_PROTOCOL:-sftp}"
case "$protocol" in
  sftp) port="${DEPLOY_PORT:-22}" ;;
  ftps) port="${DEPLOY_PORT:-21}" ;;
  *) echo "DEPLOY_PROTOCOL must be sftp or ftps" >&2; exit 2 ;;
esac

if [[ "${DEPLOY_ROOT%/}" == "$backup_root" || "$backup_root" == "${DEPLOY_ROOT%/}/"* ]]; then
  echo "DEPLOY_BACKUP_ROOT must be outside DEPLOY_ROOT." >&2
  exit 2
fi

command -v lftp >/dev/null || { echo "lftp is required (apt install lftp / brew install lftp)" >&2; exit 1; }

if [[ ! -f "$source_dir/index.html" || ! -f "$source_dir/.htaccess" ]]; then
  if $rollback; then
    echo "$source_dir does not look like a backup (index.html or .htaccess missing)." >&2
  else
    echo "dist/ is missing or incomplete. Run: npm run check" >&2
  fi
  exit 1
fi

if grep -q '__SUPABASE_' "$source_dir/.htaccess"; then
  echo "$source_dir/.htaccess still contains a CSP placeholder; rebuild with .env.local present." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%d-%H%M%S)-$$"
local_backup="deploy-backups/$stamp"

protected="--exclude-glob .well-known/ --exclude-glob cgi-bin/ --exclude-glob .user.ini --exclude-glob php.ini --exclude-glob error_log"
upload_flags="--reverse --verbose --parallel=4 --exclude-glob .DS_Store $protected"
$dry_run && upload_flags="$upload_flags --dry-run"
final_flags="$upload_flags"
$delete && final_flags="$final_flags --delete"

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

  if ! $dry_run; then
    # 1. Back up the live document root (local copy, then a copy outside the doc root).
    echo "mirror --verbose --parallel=4 $protected $DEPLOY_ROOT/ $local_backup/"
    if $remote_backup; then
      echo "mkdir -p -f $backup_root/$stamp"
      echo "mirror --reverse --parallel=4 $local_backup/ $backup_root/$stamp/"
    fi
  fi

  # 2. Upload everything except the entry points, so new assets exist before they are referenced.
  echo "mirror $upload_flags --exclude-glob index.html --exclude-glob sw.js $source_dir/ $DEPLOY_ROOT/"
  # 3. Upload the entry points last; remove stale files only when --delete / --rollback is given.
  echo "mirror $final_flags $source_dir/ $DEPLOY_ROOT/"
  echo "bye"
} > "$command_file"

if ! $dry_run; then
  mkdir -p "$local_backup"
fi

lftp -f "$command_file"

if $dry_run; then
  echo "Dry run complete. Nothing was changed."
  exit 0
fi

echo
echo "Deployed $source_dir/ to $DEPLOY_ROOT."
echo "Backup of the previous live files:"
echo "  local : $local_backup"
$remote_backup && echo "  server: $backup_root/$stamp (outside the document root)"
echo "Roll back with: scripts/deploy.sh --rollback $local_backup"
