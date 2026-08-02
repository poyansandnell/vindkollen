#!/usr/bin/env bash
# =============================================================================
# android-bundle.sh — Skapar signerad Android App Bundle (.aab) för Google Play
#
# Förutsättningar:
#   1. pnpm android:prepare har körts (dist-native och cap sync klara)
#   2. keystore.properties finns i android/ ELLER miljövariabler är satta:
#      VINDKOLLEN_STORE_FILE, VINDKOLLEN_STORE_PASSWORD,
#      VINDKOLLEN_KEY_ALIAS, VINDKOLLEN_KEY_PASSWORD
#   3. Java/Gradle är installerat (ingår i Android Studio)
#
# Output:
#   android/app/build/outputs/bundle/release/app-release.aab
# =============================================================================

set -euo pipefail

SCRIPT_ABS="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_ABS")"
ARTIFACT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ARTIFACT_DIR/android"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       Vindkollen — android:bundle            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Kontrollera att dist-native finns (android:prepare måste ha körts)
if [[ ! -d "$ARTIFACT_DIR/dist-native" ]]; then
  echo "❌  dist-native saknas — kör först: pnpm android:prepare"
  exit 1
fi

# Kontrollera signeringskonfiguration
KEYSTORE_PROPS="$ARTIFACT_DIR/android/keystore.properties"
if [[ ! -f "$KEYSTORE_PROPS" ]] && [[ -z "${VINDKOLLEN_STORE_FILE:-}" ]]; then
  echo "❌  Ingen signeringskonfiguration hittades."
  echo ""
  echo "    Alternativ 1 — keystore.properties:"
  echo "    Kopiera android/keystore.properties.example → android/keystore.properties"
  echo "    och fyll i dina värden."
  echo ""
  echo "    Alternativ 2 — miljövariabler:"
  echo "    export VINDKOLLEN_STORE_FILE=/sökväg/till/vindkollen-upload.jks"
  echo "    export VINDKOLLEN_STORE_PASSWORD=lösenord"
  echo "    export VINDKOLLEN_KEY_ALIAS=vindkollen"
  echo "    export VINDKOLLEN_KEY_PASSWORD=lösenord"
  echo ""
  echo "    Se docs/android-signing.md för fullständiga instruktioner."
  exit 1
fi

echo "── Bygger release bundle ──"
echo ""

# Gradle Wrapper
if [[ -f "./gradlew" ]]; then
  chmod +x ./gradlew
  GRADLE="./gradlew"
else
  echo "❌  gradlew saknas — är android/ -projektet initialiserat?"
  exit 1
fi

"$GRADLE" bundleRelease

AAB="$ARTIFACT_DIR/android/app/build/outputs/bundle/release/app-release.aab"

if [[ -f "$AAB" ]]; then
  SIZE=$(du -sh "$AAB" | cut -f1)
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║  ✅  android:bundle KLAR                     ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
  echo "  Fil:     $AAB"
  echo "  Storlek: $SIZE"
  echo ""
  echo "  Ladda upp till Google Play Console:"
  echo "  Release → Production → Create new release → Upload"
  echo ""
else
  echo "❌  .aab-filen hittades inte på förväntad sökväg:"
  echo "    $AAB"
  exit 1
fi
