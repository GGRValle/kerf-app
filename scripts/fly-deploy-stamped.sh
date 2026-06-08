#!/bin/sh
set -eu

commit="$(git rev-parse HEAD)"
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ -n "$(git status --porcelain)" ]; then
  dirty=true
else
  dirty=false
fi

exec fly deploy --remote-only \
  --build-arg "GIT_COMMIT=${commit}" \
  --build-arg "GIT_DIRTY=${dirty}" \
  --build-arg "BUILD_TIMESTAMP=${timestamp}" \
  "$@"
