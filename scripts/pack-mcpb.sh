#!/usr/bin/env bash
# Builds serverguard24-mcp.mcpb with only dist/, the manifest and production dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r dist manifest.json package.json package-lock.json README.md "$STAGE"/
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --silent && rm package-lock.json)
npx -y @anthropic-ai/mcpb pack "$STAGE" serverguard24-mcp.mcpb
