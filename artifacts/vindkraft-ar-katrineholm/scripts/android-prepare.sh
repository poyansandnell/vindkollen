#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# android-prepare.sh — Vindkollen Android build pipeline
#
# Kan köras från var som helst:
#   pnpm android:prepare                 (från artifacts/vindkraft-ar-katrineholm/)
#   bash scripts/android-prepare.sh      (från artifacts/vindkraft-ar-katrineholm/)
#
# Steg:
#   1. Rensa och bygg dist-native (avbryt om det misslyckas)
#   2. Verifiera disableAudio:true i dist-native
#   3. cap sync android
#   4. Verifiera package name och app name
#   5. Verifiera compileSdk / targetSdk / minSdk
#   6. Verifiera att RECORD_AUDIO saknas i AndroidManifest.xml
#   7. Verifiera att bakgrundsplats saknas
#   8. Verifiera att cleartext HTTP är blockerat
#
# cap sync körs ALDRIG om dist-native-bygget misslyckas.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_ABS="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_ABS")"
ARTIFACT_DIR="$(dirname "$SCRIPT_DIR")"
MONOREPO_ROOT="$(git -C "$ARTIFACT_DIR" rev-parse --show-toplevel)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       Vindkollen — android:prepare           ║"
echo "╚══════════════════════════════════════════════╝"
echo "  Repo:     $MONOREPO_ROOT"
echo "  Artifact: $ARTIFACT_DIR"
echo ""

cd "$ARTIFACT_DIR"

# ── 1. Rensa och bygg dist-native ────────────────────────────────────────────

echo "── Steg 1: pnpm native:build ──"
rm -rf dist-native

if ! pnpm native:build; then
  echo ""
  echo "❌  native:build misslyckades."
  echo "    dist-native är raderad. cap sync körs INTE."
  rm -rf dist-native
  exit 1
fi
echo "✅  dist-native byggd"

# ── 2. Verifiera disableAudio:true ───────────────────────────────────────────

echo ""
echo "── Steg 2: verifiera disableAudio ──"

# Vite minifierar true → !0
if grep -rq 'disableAudio[: ]*!0\|disableAudio[: ]*true' dist-native/assets/*.js 2>/dev/null; then
  echo "✅  disableAudio:true verifierad i dist-native"
else
  echo "❌  disableAudio:true hittades INTE i dist-native"
  echo "    Kontrollera capacitorBridge.ts: CameraPreview.start({ disableAudio: true })"
  rm -rf dist-native
  exit 1
fi

# ── 3. cap sync android ───────────────────────────────────────────────────────

echo ""
echo "── Steg 3: cap sync android ──"

if ! npx cap sync android; then
  echo "❌  cap sync android misslyckades"
  exit 1
fi
echo "✅  cap sync android klar"

# ── 4. Verifiera package name och app name ────────────────────────────────────

echo ""
echo "── Steg 4: package name och app name ──"

BUILD_GRADLE="$ARTIFACT_DIR/android/app/build.gradle"
STRINGS_XML="$ARTIFACT_DIR/android/app/src/main/res/values/strings.xml"

if grep -Fq 'se.catchme.vindkollen' "$BUILD_GRADLE"; then
  echo "✅  applicationId: se.catchme.vindkollen"
else
  echo "❌  applicationId är fel i build.gradle"
  exit 1
fi

if grep -Fq 'Vindkollen' "$STRINGS_XML"; then
  echo "✅  App name: Vindkollen"
else
  echo "❌  App name saknas i strings.xml"
  exit 1
fi

# ── 5. Verifiera SDK-versioner ────────────────────────────────────────────────

echo ""
echo "── Steg 5: SDK-versioner ──"

VARIABLES_GRADLE="$ARTIFACT_DIR/android/variables.gradle"

COMPILE_SDK=$(grep 'compileSdkVersion' "$VARIABLES_GRADLE" | grep -o '[0-9]*' | head -1)
TARGET_SDK=$(grep 'targetSdkVersion'   "$VARIABLES_GRADLE" | grep -o '[0-9]*' | head -1)
MIN_SDK=$(grep 'minSdkVersion'         "$VARIABLES_GRADLE" | grep -o '[0-9]*' | head -1)

echo "  compileSdk: $COMPILE_SDK"
echo "  targetSdk:  $TARGET_SDK"
echo "  minSdk:     $MIN_SDK"

if [[ "$TARGET_SDK" -ge 35 ]]; then
  echo "✅  targetSdk ≥ 35 (Google Play kräver minst 35)"
else
  echo "❌  targetSdk är $TARGET_SDK — Google Play kräver minst 35"
  exit 1
fi

# ── 6. Verifiera att RECORD_AUDIO saknas ──────────────────────────────────────

echo ""
echo "── Steg 6: RECORD_AUDIO ──"

MANIFEST="$ARTIFACT_DIR/android/app/src/main/AndroidManifest.xml"

# tools:node="remove" blockerar det från plugins — grep efter faktisk uses-permission
# (inte block-direktivet självt)
# Om RECORD_AUDIO finns: verifiera att tools:node="remove" finns inom 3 rader
if grep -q 'RECORD_AUDIO' "$MANIFEST"; then
  if grep -A3 'RECORD_AUDIO' "$MANIFEST" | grep -Fq 'tools:node="remove"'; then
    echo "✅  RECORD_AUDIO blockerat (tools:node=remove)"
  else
    echo "❌  RECORD_AUDIO deklareras utan tools:node=remove — ta bort den!"
    exit 1
  fi
else
  echo "✅  RECORD_AUDIO saknas (korrekt)"
fi

# ── 7. Verifiera att bakgrundsplats saknas ────────────────────────────────────

echo ""
echo "── Steg 7: bakgrundsplats ──"

if grep -q 'ACCESS_BACKGROUND_LOCATION' "$MANIFEST"; then
  echo "❌  ACCESS_BACKGROUND_LOCATION finns i AndroidManifest.xml — ta bort den"
  exit 1
fi
echo "✅  Ingen ACCESS_BACKGROUND_LOCATION"

# ── 8. Verifiera cleartext HTTP blockerat ─────────────────────────────────────

echo ""
echo "── Steg 8: network security ──"

NET_CFG="$ARTIFACT_DIR/android/app/src/main/res/xml/network_security_config.xml"

if [[ ! -f "$NET_CFG" ]]; then
  echo "❌  network_security_config.xml saknas"
  exit 1
fi

if grep -q 'cleartextTrafficPermitted="false"' "$NET_CFG"; then
  echo "✅  cleartext HTTP blockerat i network_security_config.xml"
elif grep -q 'usesCleartextTraffic="false"' "$MANIFEST"; then
  echo "✅  cleartext HTTP blockerat via android:usesCleartextTraffic"
else
  echo "❌  cleartext HTTP är INTE blockerat"
  exit 1
fi

# ── Klart ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅  android:prepare KLAR                    ║"
echo "║  Nästa steg:                                 ║"
echo "║    pnpm android:bundle  (skapar .aab)        ║"
echo "║    – eller –                                 ║"
echo "║    Öppna i Android Studio: cap open android  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
