#!/usr/bin/env bash
# Nightly backup of the database: dump, check, encrypt, upload.
# Run by .github/workflows/backup.yml. The repository is public, so this
# prints no row, no host and no connection string, and nothing is left behind
# as an artifact; the plaintext dump lives only on the runner's temporary disk.
#
# Needs (all secrets of the `backup` environment):
#   BACKUP_DATABASE_URL  Supabase "Session pooler" connection string of the
#                        read-only `backup` role (IPv4; the direct host is
#                        IPv6-only on the free plan)
#   BACKUP_AGE_PUBLIC_KEY  age recipients (age1...), one per line: the public
#                        halves only. Two keys, so losing one loses nothing.
#   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: any
#                        S3-compatible private bucket (Cloudflare R2 today,
#                        region "auto")
# Optional: BACKUP_MIN_DOCTORS (refuse to back up a database with fewer
# doctors than this: a wiped table must not become tonight's "good" copy;
# default 50).
#
# Nothing is deleted here. Old copies expire through the bucket's own lifecycle
# rule on daily/ (see docs/runbook.md), so a leaked token cannot make this job
# wipe the backups; monthly/ expires after a year.
set -euo pipefail
umask 077

: "${BACKUP_DATABASE_URL:?}" "${BACKUP_AGE_PUBLIC_KEY:?}" "${S3_ENDPOINT:?}" "${S3_REGION:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY_ID:?}" "${S3_SECRET_ACCESS_KEY:?}"
MIN_DOCTORS="${BACKUP_MIN_DOCTORS:-50}"
# libpq's default is "prefer", which a man in the middle can downgrade.
export PGSSLMODE="${PGSSLMODE:-require}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$WORK/jd-$STAMP.dump"
OUT="$DUMP.age"
ERR="$WORK/err.log"

# The log is public: say which step failed and a coarse category, never the
# message (it can hold a host or a user name).
category() {
  if grep -qiE 'password authentication|no pg_hba|authentication failed' "$ERR" 2>/dev/null; then echo "authentication"
  elif grep -qiE 'timeout|timed out' "$ERR" 2>/dev/null; then echo "timeout"
  elif grep -qiE 'could not translate|unreachable|refused|no route' "$ERR" 2>/dev/null; then echo "network"
  elif grep -qiE 'permission denied' "$ERR" 2>/dev/null; then echo "permission"
  elif grep -qiE 'ssl|tls|certificate' "$ERR" 2>/dev/null; then echo "tls"
  elif grep -qiE 'accessdenied|forbidden|signature' "$ERR" 2>/dev/null; then echo "storage credentials"
  fi
}
fail() {
  local c; c="$(category)"
  echo "backup failed: $1${c:+ ($c)} (details withheld: the log is public)"
  exit 1
}

# Not a wiped or half-empty database.
doctors="$(psql "$BACKUP_DATABASE_URL" -Atc 'select count(*) from public.doctors' 2>"$ERR")" || fail "doctor count"
case "$doctors" in ''|*[!0-9]*) fail "doctor count is not a number" ;; esac
[ "$doctors" -ge "$MIN_DOCTORS" ] || fail "only $doctors doctors (floor $MIN_DOCTORS): not backing up what may be damage"

# Custom format: compressed, and pg_restore can pick tables. public and private
# (the RLS policies call private.is_admin()), with their privileges: the
# migrations REVOKE execute from the public roles on the security definer
# functions, and a restore without those grants would hand them back. Left
# out: the registry mirror (refilled by the nightly sync), unfinished signups
# (a phone number and a half-filled form, kept 30 days only), sign-ins (they
# relink to a doctor by phone, linkAuthUser) and photos (storage).
pg_dump "$BACKUP_DATABASE_URL" --format=custom --no-owner \
  --schema=public --schema=private \
  --exclude-table-data=public.moh_practitioners --exclude-table-data=public.pending_signups \
  --file="$DUMP" 2>"$ERR" || fail "pg_dump exit $?"

# A dump that cannot be listed cannot be restored.
pg_restore --list "$DUMP" >"$WORK/list.txt" 2>>"$ERR" || fail "pg_restore --list exit $?"
grep -q 'TABLE DATA public doctors' "$WORK/list.txt" || fail "no doctors data in the dump"
grep -q 'FUNCTION private is_admin' "$WORK/list.txt" || fail "the private schema is missing from the dump"
[ "$(stat -c %s "$DUMP")" -gt 20000 ] || fail "dump is suspiciously small"

printf '%s\n' "$BACKUP_AGE_PUBLIC_KEY" >"$WORK/recipients.txt"
age -R "$WORK/recipients.txt" -o "$OUT" "$DUMP" 2>>"$ERR" || fail "age exit $?"
rm -f "$DUMP"

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="$S3_REGION"
# AWS CLI 2.23+ sends checksums some S3-compatible stores reject (R2 does); only when required.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
S3=(aws s3 --endpoint-url "$S3_ENDPOINT")
NAME="$(basename "$OUT")"
SIZE="$(stat -c %s "$OUT")"

# Much smaller than last night's: something was lost even if the doctors are
# all still there (a table emptied). Compared before uploading, so tonight's
# bad copy never becomes the newest.
mapfile -t previous < <("${S3[@]}" ls "s3://$S3_BUCKET/daily/" 2>>"$ERR" | awk '{print $3, $4}' | grep -E ' jd-.*\.dump\.age$' | sort -k2 | tail -1)
if [ "${#previous[@]}" -eq 1 ]; then
  prev_size="${previous[0]%% *}"
  [ "$prev_size" -gt 0 ] && [ $(( SIZE * 2 )) -lt "$prev_size" ] && fail "smaller than half of the previous backup ($SIZE bytes against $prev_size)"
fi

"${S3[@]}" cp "$OUT" "s3://$S3_BUCKET/daily/$NAME" --only-show-errors 2>>"$ERR" || fail "upload exit $?"
# The first of the month is also kept longer, in monthly/ (a year).
if [ "$(date -u +%d)" = "01" ]; then
  "${S3[@]}" cp "s3://$S3_BUCKET/daily/$NAME" "s3://$S3_BUCKET/monthly/$NAME" --only-show-errors 2>>"$ERR" || fail "monthly copy exit $?"
fi
echo "backup ok: $NAME, $SIZE bytes, $doctors doctors"
