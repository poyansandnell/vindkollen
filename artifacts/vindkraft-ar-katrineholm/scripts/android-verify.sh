#!/usr/bin/env bash
# =============================================================================
# android-verify.sh — Vindkollen Android pre-upload verifiering
#
# Kontrollerar den färdiga Android-konfigurationen utan att ändra filer.
# Kör: pnpm android:verify
# =============================================================================

set -euo pipefail

SCRIPT_ABS="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_ABS")"
ARTIFACT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ARTIFACT_DIR"

PASS=0
FAIL=0

ok()   { echo "  ✅  $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌  $1"; FAIL=$((FAIL + 1)); }

MANIFEST="$ARTIFACT_DIR/android/app/src/main/AndroidManifest.xml"
BUILD_GRADLE="$ARTIFACT_DIR/android/app/build.gradle"
VARIABLES_GRADLE="$ARTIFACT_DIR/android/variables.gradle"
STRINGS_XML="$ARTIFACT_DIR/android/app/src/main/res/values/strings.xml"
NET_CFG="$ARTIFACT_DIR/android/app/src/main/res/xml/network_security_config.xml"
STYLES_XML="$ARTIFACT_DIR/android/app/src/main/res/values/styles.xml"
SPLASH_DRAWABLE="$ARTIFACT_DIR/android/app/src/main/res/drawable/vindkollen_splash.xml"
CAMERA_BRIDGE="$ARTIFACT_DIR/src/lib/capacitorBridge.ts"
CAMERA_HOOK="$ARTIFACT_DIR/src/hooks/useCameraStream.ts"

echo ""
echo "=== Vindkollen Android-verifiering ==="
echo ""

# ── dist-native ───────────────────────────────────────────────────────────────
echo "── dist-native ──"

if [[ -d "dist-native" ]]; then
  ok "dist-native finns"
else
  fail "dist-native saknas — kör: pnpm android:prepare"
fi

if grep -rq 'disableAudio[: ]*!0\|disableAudio[: ]*true' dist-native/assets/*.js 2>/dev/null; then
  ok "disableAudio:true i dist-native"
else
  fail "disableAudio:true SAKNAS i dist-native"
fi

if grep -rqF 'Android: hoppar över Camera.checkPermissions' dist-native/assets/*.js 2>/dev/null; then
  ok "Android-bundlen hoppar över Capacitor Camera-pluginen"
else
  fail "Android-bundlen saknar skyddet mot Capacitor Camera-pluginen"
fi

# ── Package name och app name ─────────────────────────────────────────────────
echo ""
echo "── Package name och app name ──"

if grep -Fq 'se.catchme.vindkollen' "$BUILD_GRADLE" 2>/dev/null; then
  ok "applicationId: se.catchme.vindkollen"
else
  fail "applicationId är fel eller saknas i build.gradle"
fi

if grep -Fq 'namespace = "se.catchme.vindkollen"' "$BUILD_GRADLE" 2>/dev/null; then
  ok "namespace: se.catchme.vindkollen"
else
  fail "namespace är fel eller saknas i build.gradle"
fi

if grep -Fq 'Vindkollen' "$STRINGS_XML" 2>/dev/null; then
  ok "App name: Vindkollen"
else
  fail "App name saknas i strings.xml"
fi

if grep -Fq 'versionCode  5' "$BUILD_GRADLE" && grep -Fq 'versionName  "1.1"' "$BUILD_GRADLE"; then
  ok "Releaseversion: 1.1 (versionCode 5)"
else
  fail "Releaseversion är inte 1.1 (versionCode 5)"
fi

# ── SDK-versioner ─────────────────────────────────────────────────────────────
echo ""
echo "── SDK-versioner ──"

if [[ -f "$VARIABLES_GRADLE" ]]; then
  COMPILE_SDK=$(grep 'compileSdkVersion' "$VARIABLES_GRADLE" | grep -o '[0-9]*' | head -1)
  TARGET_SDK=$(grep 'targetSdkVersion'   "$VARIABLES_GRADLE" | grep -o '[0-9]*' | head -1)
  MIN_SDK=$(grep 'minSdkVersion'         "$VARIABLES_GRADLE" | grep -o '[0-9]*' | head -1)

  echo "    compileSdk: $COMPILE_SDK  |  targetSdk: $TARGET_SDK  |  minSdk: $MIN_SDK"

  [[ "$COMPILE_SDK" -ge 35 ]] && ok "compileSdk ≥ 35" || fail "compileSdk $COMPILE_SDK < 35"
  [[ "$TARGET_SDK"  -ge 35 ]] && ok "targetSdk ≥ 35"  || fail "targetSdk $TARGET_SDK < 35 (Google Play kräver minst 35)"
  [[ "$MIN_SDK"     -ge 23 ]] && ok "minSdk ≥ 23"     || fail "minSdk $MIN_SDK < 23"
else
  fail "variables.gradle saknas"
fi

# ── Behörigheter ──────────────────────────────────────────────────────────────
echo ""
echo "── Behörigheter ──"

if [[ -f "$MANIFEST" ]]; then
  grep -Fq 'android.permission.CAMERA' "$MANIFEST" && ok "CAMERA" || fail "CAMERA saknas"
  grep -Fq 'ACCESS_FINE_LOCATION'      "$MANIFEST" && ok "ACCESS_FINE_LOCATION" || fail "ACCESS_FINE_LOCATION saknas"
  grep -Fq 'ACCESS_COARSE_LOCATION'    "$MANIFEST" && ok "ACCESS_COARSE_LOCATION" || fail "ACCESS_COARSE_LOCATION saknas"
  grep -Fq 'android.permission.INTERNET' "$MANIFEST" && ok "INTERNET" || fail "INTERNET saknas"

  # RECORD_AUDIO: tillåtet bara som block-direktiv (tools:node="remove")
  if grep -q 'RECORD_AUDIO' "$MANIFEST"; then
    if grep -A3 'RECORD_AUDIO' "$MANIFEST" | grep -Fq 'tools:node="remove"'; then
      ok "RECORD_AUDIO blockerat (tools:node=remove)"
    else
      fail "RECORD_AUDIO deklareras utan tools:node=remove"
    fi
  else
    ok "RECORD_AUDIO saknas (korrekt)"
  fi

  # Bakgrundsplats
  if grep -q 'ACCESS_BACKGROUND_LOCATION' "$MANIFEST"; then
    fail "ACCESS_BACKGROUND_LOCATION finns — ta bort den"
  else
    ok "Ingen ACCESS_BACKGROUND_LOCATION"
  fi
else
  fail "AndroidManifest.xml saknas"
fi

# ── Android branding ─────────────────────────────────────────────────────────
echo ""
echo "── Android-varumärke ──"

if [[ -f "$SPLASH_DRAWABLE" ]] && grep -Fq '@mipmap/ic_launcher_foreground' "$SPLASH_DRAWABLE"; then
  ok "Startbild använder Vindkollen-launcherresursen"
else
  fail "Vindkollen-startbild saknas eller använder fel resurs"
fi

if [[ -f "$STYLES_XML" ]] && grep -Fq '@drawable/vindkollen_splash' "$STYLES_XML" && \
  grep -Fq 'windowSplashScreenAnimatedIcon' "$STYLES_XML"; then
  ok "Splash-tema är konfigurerat för Android 7–11 och Android 12+"
else
  fail "Splash-temat saknar Vindkollen-konfiguration"
fi

if find "$ARTIFACT_DIR/android/app/src/main/res" -type f -name 'splash.png' -print -quit | grep -q .; then
  fail "Äldre splash.png hittades fortfarande i Android-resurserna"
else
  ok "Ingen äldre blå splash.png finns kvar"
fi

LAUNCHER_COUNT=$(find "$ARTIFACT_DIR/android/app/src/main/res"/mipmap-* -type f \
  \( -name 'ic_launcher.png' -o -name 'ic_launcher_round.png' -o -name 'ic_launcher_foreground.png' \) \
  -size +0c 2>/dev/null | wc -l | tr -d ' ')
if [[ "$LAUNCHER_COUNT" -eq 15 ]]; then
  ok "Alla 15 Vindkollen-launcherresurser finns"
else
  fail "Förväntade 15 launcherresurser, hittade $LAUNCHER_COUNT"
fi

# ── Android AR-kameraväg ─────────────────────────────────────────────────────
echo ""
echo "── Android AR-kameraväg ──"

if grep -Fq 'if (isAndroidNative())' "$CAMERA_BRIDGE" && \
  grep -Fq 'hoppar över Camera.checkPermissions' "$CAMERA_BRIDGE"; then
  ok "Android hoppar över Capacitor Camera.checkPermissions"
else
  fail "Android-skydd mot Capacitor Camera-pluginen saknas"
fi

if grep -Fq 'if (isIosNative())' "$CAMERA_HOOK" && \
  grep -Fq 'navigator.mediaDevices.getUserMedia' "$CAMERA_HOOK"; then
  ok "Android använder WebView getUserMedia i AR-flödet"
else
  fail "Android getUserMedia-väg saknas i AR-flödet"
fi

# ── Network security ──────────────────────────────────────────────────────────
echo ""
echo "── Network security ──"

if [[ -f "$NET_CFG" ]]; then
  ok "network_security_config.xml finns"
  grep -q 'cleartextTrafficPermitted="false"' "$NET_CFG" && \
    ok "cleartext HTTP blockerat" || fail "cleartext HTTP INTE blockerat"
else
  fail "network_security_config.xml saknas"
fi

# ── Deep link ─────────────────────────────────────────────────────────────────
echo ""
echo "── Deep link ──"

if [[ -f "$MANIFEST" ]]; then
  grep -Fq 'vindkollen' "$MANIFEST" && ok "vindkollen:// deep link" || fail "vindkollen:// deep link saknas"
fi

# ── Release signing ───────────────────────────────────────────────────────────
echo ""
echo "── Release signing ──"

KEYSTORE_PROPS="$ARTIFACT_DIR/android/keystore.properties"
if [[ -f "$KEYSTORE_PROPS" ]]; then
  ok "keystore.properties finns (lokal release-signering konfigurerad)"
elif [[ -n "${VINDKOLLEN_STORE_FILE:-}" ]]; then
  ok "Signeringskonfiguration via miljövariabler (VINDKOLLEN_STORE_FILE)"
else
  echo "  ℹ️   Ingen signeringskonfiguration — kör android:bundle utan signering"
  echo "       Se docs/android-signing.md för instruktioner"
fi

# ── Sammanfattning ────────────────────────────────────────────────────────────
echo ""
echo "───────────────────────────────────────────────"
echo "Totalt: $PASS godkänd(a), $FAIL misslyckad(e)"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "❌  Verifiering MISSLYCKADES — ladda INTE upp till Google Play."
  exit 1
else
  echo "✅  Allt godkänt — redo för Google Play-uppladdning."
fi
