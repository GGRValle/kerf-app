#!/bin/sh
set -eu

commit="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  dirty=true
else
  dirty=false
fi

exec fly deploy --remote-only \
  --build-arg "GIT_COMMIT=${commit}" \
  --build-arg "GIT_DIRTY=${dirty}" \
  "$@"
