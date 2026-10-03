#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

env_file=${APP_ENV_FILE:-.env}
database_url_file=${BUILD_DATABASE_URL_FILE:?Set BUILD_DATABASE_URL_FILE to a private file containing a disposable build database URL}
platform=${TARGET_PLATFORM:-linux/amd64}

if [[ ! -r "$env_file" ]]; then
  echo "Cannot read build settings: $env_file" >&2
  exit 1
fi
if [[ ! -s "$database_url_file" ]]; then
  echo "The build database URL file is missing or empty." >&2
  exit 1
fi

# Load public build settings as shell variables, but do not export runtime secrets.
source "$env_file"

for key in \
  NEXT_PUBLIC_STATICALLY_OPTIMIZE_PHOTOS \
  NEXT_PUBLIC_STATICALLY_OPTIMIZE_PAGES \
  NEXT_PUBLIC_STATICALLY_OPTIMIZE_PHOTO_OG_IMAGES \
  NEXT_PUBLIC_STATICALLY_OPTIMIZE_OG_IMAGES \
  NEXT_PUBLIC_STATICALLY_OPTIMIZE_PHOTO_CATEGORIES \
  NEXT_PUBLIC_STATICALLY_OPTIMIZE_PHOTO_CATEGORY_OG_IMAGES
do
  if [[ "${!key-}" != "1" ]]; then
    echo "$key must be 1 for this pre-generated build." >&2
    exit 1
  fi
done

if [[ -z "${NEXT_PUBLIC_DOMAIN-}" || -z "${NEXT_PUBLIC_MINIO_DOMAIN-}" || -z "${NEXT_PUBLIC_MINIO_BUCKET-}" ]]; then
  echo "Set the public site domain and existing MinIO host/bucket in $env_file." >&2
  exit 1
fi
if [[ "${NEXT_PUBLIC_DISABLE_BLUR-}" != "1" ]]; then
  echo "NEXT_PUBLIC_DISABLE_BLUR must be 1 to omit stored blur data from prebuilt page payloads." >&2
  exit 1
fi

build_args=(
  --build-arg "APP_UID=${APP_UID:-1001}"
  --build-arg "APP_GID=${APP_GID:-1001}"
  --build-arg "NEXT_BUILD_WORKERS=${NEXT_BUILD_WORKERS:-2}"
)
while IFS= read -r key; do
  value=${!key-}
  if [[ -n "$value" ]]; then
    build_args+=(--build-arg "$key=$value")
  fi
done < <(awk '$1 == "ARG" && $2 ~ /^NEXT_PUBLIC_/ { print $2 }' Dockerfile)

docker buildx build \
  --platform "$platform" \
  --load \
  --secret "id=build_database_url,src=$database_url_file" \
  --tag "exif-photo-blog:${WEB_IMAGE_TAG:-local}" \
  "${build_args[@]}" \
  .
