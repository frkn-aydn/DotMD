#!/usr/bin/env bash
# Print SHA-256 checksums for DotMD macOS release DMGs.
# Usage: ./scripts/update-cask-shas.sh 1.1.0

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>" >&2
  echo "Example: $0 1.1.0" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

ARM_DMG="$DIST/DotMD-${VERSION}-arm64.dmg"
INTEL_DMG="$DIST/DotMD-${VERSION}.dmg"

if [[ ! -f "$ARM_DMG" || ! -f "$INTEL_DMG" ]]; then
  echo "Missing DMG files in dist/. Build first:" >&2
  echo "  make mac" >&2
  exit 1
fi

echo "Apple Silicon (arm64):"
shasum -a 256 "$ARM_DMG"
echo
echo "Intel (x64):"
shasum -a 256 "$INTEL_DMG"
