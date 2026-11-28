#!/usr/bin/env bash
# Build agentdist, build the harness image if needed, and run the end-to-end tests in it.
#
#   e2e/run.sh [--harness claude,codex] [--scope user|local] [--keep]
#
# Results land in e2e/results/: report.md, results.json, and one transcript per harness and scope.
# Set E2E_NETWORK=bridge to let harnesses reach the network; by default they cannot, so nothing
# can reach a real model or account.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCKER=${DOCKER:-docker}
command -v "$DOCKER" >/dev/null || DOCKER=/Applications/OrbStack.app/Contents/MacOS/xbin/docker
IMAGE=${E2E_IMAGE:-agentdist-e2e}

pnpm exec tsup >/dev/null
"$DOCKER" build ${E2E_REBUILD:+--no-cache} -t "$IMAGE" -f e2e/Dockerfile e2e
rm -rf e2e/results && mkdir -p e2e/results
"$DOCKER" run --rm --init \
  --network "${E2E_NETWORK:-none}" \
  -v "$PWD:/src:ro" \
  -v "$PWD/e2e/results:/results" \
  "$IMAGE" --out /results "$@"
