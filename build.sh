#!/usr/bin/env bash
set -euo pipefail

# Build (and optionally push) a gluetun-gui image with commit metadata baked in.
#
# Usage:
#   ./build.sh
#   IMG=raddadengineer/gluetun-gui TAG=v0.4.2 ./build.sh
#   IMG=raddadengineer/gluetun-gui TAG=v0.4.2 PUSH=1 ./build.sh
#   IMG=raddadengineer/gluetun-gui TAG=v0.4.2 PLATFORMS=linux/amd64,linux/arm64 PUSH=1 ./build.sh
#
# Env vars:
#   IMG        Image repo/name (default: raddadengineer/gluetun-gui)
#   TAG        Tag (default: v<server/package.json version>)
#   PUSH       1 to push after build (default: 0)
#   PLATFORMS  If set, use buildx multi-arch build (e.g. linux/amd64,linux/arm64)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

IMG="${IMG:-raddadengineer/gluetun-gui}"
PUSH="${PUSH:-0}"
PLATFORMS="${PLATFORMS:-}"

SERVER_VERSION="$(node -p "require('./server/package.json').version" 2>/dev/null || true)"
if [[ -z "${TAG:-}" ]]; then
  if [[ -n "$SERVER_VERSION" ]]; then
    TAG="v$SERVER_VERSION"
  else
    TAG="dev"
  fi
fi

GIT_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
GIT_REF="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
GIT_COMMITTED_AT="$(git log -1 --format=%cI 2>/dev/null || true)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Building $IMG:$TAG (and $IMG:latest)"
echo "  sha:        ${GIT_SHA:-—}"
echo "  ref:        ${GIT_REF:-—}"
echo "  committed:  ${GIT_COMMITTED_AT:-—}"
echo "  built:      $BUILD_TIME"

build_args=(
  --build-arg "GLUETUN_GUI_GIT_SHA=${GIT_SHA}"
  --build-arg "GLUETUN_GUI_GIT_REF=${GIT_REF}"
  --build-arg "GLUETUN_GUI_GIT_COMMITTED_AT=${GIT_COMMITTED_AT}"
  --build-arg "GLUETUN_GUI_BUILD_TIME=${BUILD_TIME}"
)

if [[ -n "$PLATFORMS" ]]; then
  # Multi-arch build (requires buildx and a builder instance).
  cmd=(docker buildx build --platform "$PLATFORMS" "${build_args[@]}" -t "$IMG:$TAG" -t "$IMG:latest")
  if [[ "$PUSH" == "1" ]]; then
    cmd+=(--push)
  else
    cmd+=(--load)
  fi
  cmd+=(.)
  "${cmd[@]}"
else
  docker build "${build_args[@]}" -t "$IMG:$TAG" -t "$IMG:latest" .
  if [[ "$PUSH" == "1" ]]; then
    docker push "$IMG:$TAG"
    docker push "$IMG:latest"
  fi
fi

echo "Done."

