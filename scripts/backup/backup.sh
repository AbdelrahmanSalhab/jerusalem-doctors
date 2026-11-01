#!/usr/bin/env bash
# Nightly backup of the database: dump, check, encrypt, upload, prune.
# Run by .github/workflows/backup.yml. The repository is public, so this
# prints no row, no host and no connection string, and nothing is left behind
# as an artifact; the plaintext dump lives only on the runner's temporary disk.
#
# Needs (all secrets of the `backup` environment):
#   BACKUP_DATABASE_URL  Supabase "Session pooler" connection string (IPv4; the
#                        direct host is IPv6-only on the free plan)
#   BACKUP_AGE_PUBLIC_KEY  age recipient (age1...): only the public half is here
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
# Optional: BACKUP_KEEP (how many to keep, default 30).
set -euo pipefail
umask 077

: "${BACKUP_DATABASE_URL:?}" "${BACKUP_AGE_PUBLIC_KEY:?}" "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${R2_BUCKET:?}"
KEEP="${BACKUP_KEEP:-30}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$WORK/jd-$STAMP.dump"
OUT="$DUMP.age"
ERR="$WORK/err.log"
fail() { echo "backup failed: $1 (details withheld: the log is public)"; exit 1; }

# Custom format: compressed, and pg_restore can pick tables. The public schema
# only: sign-ins relink to a doctor by phone (linkAuthUser), photos are in
# storage, and the registry mirror is refilled by the nightly sync, so it is
# left out to keep the file small.
pg_dump "$BACKUP_DATABASE_URL" --format=custom --no-owner --no-privileges \
  --schema=public --exclude-table-data=public.moh_practitioners \
  --file="$DUMP" 2>"$ERR" || fail "pg_dump exit $?"

# A dump that cannot be listed cannot be restored.
pg_restore --list "$DUMP" >"$WORK/list.txt" 2>>"$ERR" || fail "pg_restore --list exit $?"
grep -q 'TABLE DATA public doctors' "$WORK/list.txt" || fail "no doctors data in the dump"
[ "$(stat -c %s "$DUMP")" -gt 20000 ] || fail "dump is suspiciously small"

age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$OUT" "$DUMP" 2>>"$ERR" || fail "age exit $?"
rm -f "$DUMP"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
# AWS CLI 2.23+ sends checksums R2 rejects unless they are only used when required.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
S3=(aws s3 --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com")
"${S3[@]}" cp "$OUT" "s3://$R2_BUCKET/daily/$(basename "$OUT")" --only-show-errors 2>>"$ERR" || fail "upload exit $?"

# Keep the newest $KEEP; the names sort by date.
mapfile -t all < <("${S3[@]}" ls "s3://$R2_BUCKET/daily/" 2>>"$ERR" | awk '{print $4}' | grep -E '^jd-.*\.dump\.age$' | sort)
extra=$(( ${#all[@]} - KEEP ))
if [ "$extra" -gt 0 ]; then
  for f in "${all[@]:0:extra}"; do "${S3[@]}" rm "s3://$R2_BUCKET/daily/$f" --only-show-errors 2>>"$ERR" || fail "prune exit $?"; done
fi
echo "backup ok: $(basename "$OUT"), $(stat -c %s "$OUT") bytes, ${#all[@]} kept before pruning"
