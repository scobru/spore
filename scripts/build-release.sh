#!/usr/bin/env bash
# Spore - Local Linux & macOS Release Packaging Script
# Builds the production web frontend and compiles the Tauri v2 desktop installer.

set -euo pipefail

echo -e "\033[36m🍄 [Spore] Starting Release Build...\033[0m"

# 1. Check prerequisites
command -v npm >/dev/null 2>&1 || { echo "npm is required but not installed. Aborting." >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "Cargo/Rust is required but not installed. Aborting." >&2; exit 1; }

# 2. Build Frontend
echo -e "\033[33m📦 [1/4] Compiling frontend assets...\033[0m"
npm run build

# 3. Compile Tauri Bundle
echo -e "\033[33m🦀 [2/4] Compiling Tauri v2 Rust desktop bundle...\033[0m"
npx tauri build

# 4. Collect Release Installers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$SCRIPT_DIR/../release"
mkdir -p "$RELEASE_DIR"

BUNDLE_DIR="$SCRIPT_DIR/../src-tauri/target/release/bundle"

echo -e "\033[33m🔒 [3/4] Collecting installers and generating SHA256 checksums...\033[0m"

# Find DMG, AppImage, Deb, MSI, EXE if present
find "$BUNDLE_DIR" -type f \( -name "*.dmg" -o -name "*.AppImage" -o -name "*.deb" -o -name "*.exe" -o -name "*.msi" \) -exec cp {} "$RELEASE_DIR/" \;

# Generate SHA256SUMS
cd "$RELEASE_DIR"
if command -v sha256sum >/dev/null 2>&1; then
    sha256sum *.* > SHA256SUMS.txt
elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 *.* > SHA256SUMS.txt
fi

echo -e "\033[32m✅ [4/4] Release build completed successfully!\033[0m"
echo -e "\033[36m📁 Output directory: $RELEASE_DIR\033[0m"
ls -lh "$RELEASE_DIR"

