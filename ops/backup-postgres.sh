#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/private-backup-directory" >&2
  exit 2
fi

backup_dir=$1
umask 077
mkdir -p "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_dir/exif-photo-blog-public-$timestamp.dump"

script_dir=$(dirname "$0")
case "$script_dir" in
  /*) ;;
  *) script_dir="$PWD/$script_dir" ;;
esac

sh "$script_dir/compose.sh" exec -T postgres sh -eu -c \
  'pg_dump --format=custom --no-owner --no-privileges --schema=public --username "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$archive"

if [ ! -s "$archive" ]; then
  rm -f "$archive"
  echo "PostgreSQL dump is empty" >&2
  exit 1
fi

echo "Wrote $archive"
