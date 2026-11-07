#!/usr/bin/env bash
# Nightly copy of the doctors' profile photos to the backup bucket (photos/).
# Run by .github/workflows/backup.yml after the database dump: the dump holds
# the photo's name (profile_picture_url) but not the file, which lives in
# Supabase Storage. Like backup.sh it prints no name and no connection string
# (the repository is public), and leaves nothing behind.
#
# Needs the same secrets of the `backup` environment as backup.sh, minus the
# age key: BACKUP_DATABASE_URL, S3_ENDPOINT, S3_REGION, S3_BUCKET,
# S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY. No new secret:
#   - the list of photos is read from storage.objects with the same read-only
#     `backup` role (pg_read_all_data covers it);
#   - the bucket is public, so the files are fetched from their public URL; the
#     project is the part after the dot of the connection string's user,
#     `backup.<project ref>`.
# The photos are not encrypted: anyone with the link can already see them.
#
# Nothing is deleted here and nothing is locked. A photo that is replaced or
# whose doctor is deleted stops being refreshed, and the bucket's lifecycle rule
# on photos/ (60 days, like daily/; see docs/runbook.md) removes it. Without
# that rule a deleted doctor's photo would stay in the copy for good.
set -euo pipefail
umask 077

: "${BACKUP_DATABASE_URL:?}" "${S3_ENDPOINT:?}" "${S3_REGION:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY_ID:?}" "${S3_SECRET_ACCESS_KEY:?}"
BUCKET=doctor-photos
export PGSSLMODE="${PGSSLMODE:-require}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ERR="$WORK/err.log"

# The log is public: say which step failed, never the message.
fail() {
  echo "photo backup failed: $1 (details withheld: the log is public)"
  exit 1
}

# backup.<ref>:password@host -> <ref>
user="${BACKUP_DATABASE_URL#*://}"
user="${user%%:*}"
ref="${user##*.}"
[[ "$ref" =~ ^[a-z0-9]{20}$ ]] || fail "cannot read the project from the connection string"
BASE="https://$ref.supabase.co/storage/v1/object/public/$BUCKET"

psql "$BACKUP_DATABASE_URL" -Atc "select name from storage.objects where bucket_id = '$BUCKET' order by name" >"$WORK/list.txt" 2>"$ERR" || fail "listing the photos"

mkdir "$WORK/photos"
copied=0 gone=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  # Named by doctor id with a known extension (lib/photo.ts); anything else is not ours to fetch.
  [[ "$name" =~ ^[0-9a-f-]{36}\.(jpg|png|webp)$ ]] || fail "an object with an unexpected name"
  code="$(curl -sS --retry 3 --max-time 60 -o "$WORK/photos/$name" -w '%{http_code}' "$BASE/$name" 2>"$ERR")" || fail "download"
  case "$code" in
    200) copied=$((copied + 1)) ;;
    404) gone=$((gone + 1)); rm -f "$WORK/photos/$name" ;; # deleted since the listing
    *) fail "download answered $code" ;;
  esac
done <"$WORK/list.txt"

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="$S3_REGION"
# AWS CLI 2.23+ sends checksums some S3-compatible stores reject (R2 does); only when required.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws s3 --endpoint-url "$S3_ENDPOINT" sync "$WORK/photos" "s3://$S3_BUCKET/photos/" --only-show-errors 2>"$ERR" || fail "upload"
echo "photos ok: $copied files, $(du -sk "$WORK/photos" | cut -f1) KB ($gone deleted since the listing)"
