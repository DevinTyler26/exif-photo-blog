#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 /path/to/postgres-archive.dump disposable_database_name" >&2
  exit 2
fi

archive=$1
restore_db=$2

if [ ! -r "$archive" ]; then
  echo "Cannot read archive: $archive" >&2
  exit 1
fi

case "$restore_db" in
  ''|*[!a-zA-Z0-9_]*)
    echo "Use a database name containing only letters, digits, and underscores" >&2
    exit 2
    ;;
esac

script_dir=$(dirname "$0")
case "$script_dir" in
  /*) ;;
  *) script_dir="$PWD/$script_dir" ;;
esac

if ! sh "$script_dir/compose.sh" exec -T postgres sh -c \
  '[ "$1" != "$POSTGRES_DB" ]' sh "$restore_db"; then
  echo "Refusing to restore into the configured application database" >&2
  exit 1
fi

# createdb fails if the disposable target already exists.
sh "$script_dir/compose.sh" exec -T postgres sh -eu -c \
  'createdb --owner="$APP_DB_USER" --username="$POSTGRES_USER" "$1"' \
  sh "$restore_db"

sh "$script_dir/compose.sh" exec -T postgres sh -eu -c \
  'pg_restore --clean --if-exists --no-owner --no-privileges --role="$APP_DB_USER" --username="$POSTGRES_USER" --dbname="$1"' \
  sh "$restore_db" \
  < "$archive"

echo "Restored $archive into disposable database $restore_db"
