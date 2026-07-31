#!/usr/bin/env bash
# =============================================================================
# ios-prepare.sh — Vindkollen iOS build pipeline
#
# Kör från: artifacts/vindkraft-ar-katrineholm/   (eller via pnpm ios:prepare)
#
# Steg:
#   1. Verifiera macOS-plattform och arm64/x64-arkitektur
#   2. Kontrollera att @tailwindcss/oxide darwin native binding är installerad
#   3. Radera gammal dist-native för att garantera ett färskt bygge
#   4. Bygg dist-native — avbryt direkt och håll dist-native raderad om det misslyckas
#   5. Verifiera att disableAudio:true finns i det byggda paketet
#   6. Verifiera att NSMicrophoneUsageDescription INTE finns i ios/ eller scripts/
#   7. Verifiera Bundle ID och Display Name
#   8. Kör npx cap sync ios (bara om steg 3–7 lyckas)
#   9. Kör ios-setup.sh (skriver privacy strings i Info.plist)
#  10. Kör ios-verify.sh (full SPM + bundle-ID-verifiering)
#
# set -euo pipefail: varje steg som misslyckas avbryter omedelbart.
# cap sync körs ALDRIG om dist-native-bygget misslyckades.
# =============================================================================

set -euo pipefail

# ── Hitta rotkataloger ────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONOREPO_ROOT="$(cd "$ARTIFACT_DIR/../.." && pwd)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║        Vindkollen — ios:prepare              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Verifiera macOS ────────────────────────────────────────────────────────

if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌  ios:prepare måste köras på macOS (uname = $(uname))"
  exit 1
fi

ARCH="$(uname -m)"
echo "✅  Plattform: macOS $ARCH"

# ── 2. Kontrollera @tailwindcss/oxide native binding ─────────────────────────

echo ""
echo "── Steg 2: native binding ──"

if [[ "$ARCH" == "arm64" ]]; then
  OXIDE_PKG="@tailwindcss/oxide-darwin-arm64"
else
  OXIDE_PKG="@tailwindcss/oxide-darwin-x64"
fi

OXIDE_DIR="$MONOREPO_ROOT/node_modules/$OXIDE_PKG"

if [[ ! -d "$OXIDE_DIR" ]]; then
  echo "⚠️   $OXIDE_PKG saknas — kör pnpm install..."
  cd "$MONOREPO_ROOT"
  pnpm install
fi

if [[ ! -d "$OXIDE_DIR" ]]; then
  echo "❌  $OXIDE_PKG saknas efter pnpm install."
  echo "    Prova: rm -rf node_modules && pnpm install"
  exit 1
fi

echo "✅  $OXIDE_PKG installerad"

# Verifiera att oxide faktiskt laddar (kan require:a sin binding)
cd "$ARTIFACT_DIR"
if ! node --input-type=module \
     --eval "import('@tailwindcss/oxide').then(()=>process.exit(0)).catch(()=>process.exit(1))" \
     2>/dev/null; then
  echo "❌  @tailwindcss/oxide kan inte ladda sin native binding."
  echo "    Kör: rm -rf node_modules && pnpm install"
  exit 1
fi
echo "✅  @tailwindcss/oxide laddar korrekt"

# ── 3. Radera gammal dist-native ─────────────────────────────────────────────

echo ""
echo "── Steg 3: rensa dist-native ──"
rm -rf dist-native
echo "✅  dist-native raderad"

# ── 4. Bygg dist-native ───────────────────────────────────────────────────────

echo ""
echo "── Steg 4: pnpm native:build ──"

if ! pnpm native:build; then
  echo ""
  echo "❌  native:build misslyckades."
  echo "    dist-native är raderad. cap sync körs INTE."
  rm -rf dist-native
  exit 1
fi

echo "✅  dist-native byggd"

# ── 5. Verifiera disableAudio: true i bygget ──────────────────────────────────

echo ""
echo "── Steg 5: verifiera disableAudio ──"

# Efter minifiering blir true → !0 och false → !1
# Söker efter alla varianter: disableAudio:true, disableAudio:!0, disableAudio: true
if grep -rq 'disableAudio[: ]*!0\|disableAudio[: ]*true' dist-native/assets/*.js 2>/dev/null; then
  echo "✅  disableAudio: true verifierad i dist-native"
else
  echo "❌  disableAudio: true hittades INTE i dist-native/assets/*.js"
  echo "    Kontrollera capacitorBridge.ts: CameraPreview.start({ disableAudio: true })"
  rm -rf dist-native
  exit 1
fi

# ── 6. Verifiera att NSMicrophoneUsageDescription inte finns ─────────────────

echo ""
echo "── Steg 6: mikrofon-verifiering ──"

MICROPHONE_HITS=$(grep -r "NSMicrophoneUsageDescription" \
  ios/ scripts/ 2>/dev/null | grep -v "^Binary" || true)

if [[ -n "$MICROPHONE_HITS" ]]; then
  echo "❌  NSMicrophoneUsageDescription hittades — ta bort den!"
  echo "$MICROPHONE_HITS"
  exit 1
fi
echo "✅  Ingen NSMicrophoneUsageDescription i ios/ eller scripts/"

# ── 7. Verifiera Bundle ID och Display Name ───────────────────────────────────

echo ""
echo "── Steg 7: Bundle ID och Display Name ──"

PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"
PLIST="ios/App/App/Info.plist"

if ! grep -q "se\.catchme\.vindkollen" "$PBXPROJ" 2>/dev/null; then
  echo "❌  Bundle ID är fel eller saknas i project.pbxproj"
  exit 1
fi
echo "✅  Bundle ID: se.catchme.vindkollen"

if ! grep -q "Vindkollen" "$PLIST" 2>/dev/null; then
  echo "❌  Display Name saknas i Info.plist"
  exit 1
fi
echo "✅  Display Name: Vindkollen"

# Verifiera att obligatoriska privacy-nycklar finns
for KEY in NSCameraUsageDescription NSLocationWhenInUseUsageDescription \
           NSMotionUsageDescription NSPhotoLibraryUsageDescription; do
  if ! grep -q "$KEY" "$PLIST" 2>/dev/null; then
    echo "❌  Privacynyckel saknas i Info.plist: $KEY"
    exit 1
  fi
done
echo "✅  Privacy-nycklar: kamera, plats, rörelse, fotobibliotek"

# ── 8. cap sync ios ───────────────────────────────────────────────────────────

echo ""
echo "── Steg 8: cap sync ios ──"

if ! npx cap sync ios; then
  echo "❌  cap sync ios misslyckades"
  exit 1
fi
echo "✅  cap sync ios klar"

# ── 9. ios-setup.sh (privacy strings) ────────────────────────────────────────

echo ""
echo "── Steg 9: ios-setup.sh ──"
bash scripts/ios-setup.sh

# ── 10. ios-verify.sh (full SPM + bundle-ID-verifiering) ─────────────────────

echo ""
echo "── Steg 10: ios-verify.sh ──"
bash scripts/ios-verify.sh

# ── Klart ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅  ios:prepare KLAR                        ║"
echo "║  Öppna Xcode → Product → Archive             ║"
echo "║  Ladda upp till App Store Connect            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
