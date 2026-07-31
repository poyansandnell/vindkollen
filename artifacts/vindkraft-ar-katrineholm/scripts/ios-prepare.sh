#!/usr/bin/env bash
# =============================================================================
# ios-prepare.sh — Vindkollen iOS build pipeline
#
# Kan köras från var som helst:
#   pnpm ios:prepare                        (från artifacts/vindkraft-ar-katrineholm/)
#   bash artifacts/vindkraft-ar-katrineholm/scripts/ios-prepare.sh   (från repo-roten)
#   bash scripts/ios-prepare.sh             (från artifacts/vindkraft-ar-katrineholm/)
#
# Katalogupplösning baseras på skriptets egna absoluta sökväg ($0 / realpath),
# aldrig på var kommandot kördes ifrån (ingen relativ cd på CWD).
#
# Steg:
#   1. Verifiera macOS-plattform
#   2. Radera gammal dist-native
#   3. Bygg dist-native — avbryt och håll dist-native raderad om det misslyckas
#      (om @tailwindcss/oxide saknar sin native binding misslyckas Vite här)
#   4. Verifiera disableAudio:true i det byggda paketet
#   5. Verifiera att NSMicrophoneUsageDescription INTE finns
#   6. Verifiera Bundle ID och Display Name
#   7. cap sync ios (bara om 2-6 lyckades)
#   8. ios-setup.sh (privacy strings)
#   9. ios-verify.sh (SPM + bundle-ID)
#
# set -euo pipefail: varje fel avbryter omedelbart.
# cap sync körs ALDRIG om dist-native-bygget misslyckades.
# =============================================================================

set -euo pipefail

# ── Hitta kataloger via skriptets absoluta sökväg ─────────────────────────────
#
# Använder git rev-parse för att hitta repo-roten — fungerar oavsett
# varifrån kommandot körs (repo-roten, artifact-mappen, Scripts-mappen).

SCRIPT_ABS="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_ABS")"
ARTIFACT_DIR="$(dirname "$SCRIPT_DIR")"
MONOREPO_ROOT="$(git -C "$ARTIFACT_DIR" rev-parse --show-toplevel)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║        Vindkollen — ios:prepare              ║"
echo "╚══════════════════════════════════════════════╝"
echo "  Repo:     $MONOREPO_ROOT"
echo "  Artifact: $ARTIFACT_DIR"
echo ""

# ── 1. Verifiera macOS ────────────────────────────────────────────────────────

if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌  ios:prepare måste köras på macOS (uname = $(uname))"
  exit 1
fi

ARCH="$(uname -m)"
echo "✅  Plattform: macOS $ARCH"

# ── 2. Radera gammal dist-native ─────────────────────────────────────────────

echo ""
echo "── Steg 2: rensa dist-native ──"
cd "$ARTIFACT_DIR"
rm -rf dist-native
echo "✅  dist-native raderad"

# ── 3. Bygg dist-native ───────────────────────────────────────────────────────
#
# Om @tailwindcss/oxide saknar sin darwin native binding misslyckas Vite här
# med "Cannot find native binding" — det är den riktiga verifieringen.
# cap sync körs ALDRIG om bygget misslyckas.

echo ""
echo "── Steg 3: pnpm native:build ──"

if ! pnpm native:build; then
  echo ""
  echo "❌  native:build misslyckades."
  echo "    dist-native är raderad. cap sync körs INTE."
  echo "    Om felet är 'Cannot find native binding': kör rm -rf node_modules && pnpm install"
  rm -rf dist-native
  exit 1
fi

echo "✅  dist-native byggd"

# ── 4. Verifiera disableAudio:true i bygget ───────────────────────────────────

echo ""
echo "── Steg 4: verifiera disableAudio ──"

# Vite minifierar true → !0, söker båda formaten
if grep -rq 'disableAudio[: ]*!0\|disableAudio[: ]*true' "$ARTIFACT_DIR/dist-native/assets/"*.js 2>/dev/null; then
  echo "✅  disableAudio:true verifierad i dist-native"
else
  echo "❌  disableAudio:true hittades INTE i dist-native/assets/*.js"
  echo "    Kontrollera capacitorBridge.ts: CameraPreview.start({ disableAudio: true })"
  rm -rf dist-native
  exit 1
fi

# ── 6. Verifiera att NSMicrophoneUsageDescription inte finns ──────────────────

echo ""
echo "── Steg 5: mikrofon-verifiering ──"

MICROPHONE_HITS=$(grep -n "NSMicrophoneUsageDescription" \
  "$ARTIFACT_DIR/ios/App/App/Info.plist" \
  "$ARTIFACT_DIR/scripts/ios-setup.sh" 2>/dev/null || true)

if [[ -n "$MICROPHONE_HITS" ]]; then
  echo "❌  NSMicrophoneUsageDescription hittades i Info.plist eller ios-setup.sh — ta bort den!"
  echo "$MICROPHONE_HITS"
  exit 1
fi
echo "✅  Ingen NSMicrophoneUsageDescription i Info.plist eller ios-setup.sh"

# ── 7. Verifiera Bundle ID och Display Name ───────────────────────────────────

echo ""
echo "── Steg 6: Bundle ID och Display Name ──"

PBXPROJ="$ARTIFACT_DIR/ios/App/App.xcodeproj/project.pbxproj"
PLIST="$ARTIFACT_DIR/ios/App/App/Info.plist"

if ! grep -q "se\.catchme\.vindkollen" "$PBXPROJ" 2>/dev/null; then
  echo "❌  Bundle ID fel eller saknas i project.pbxproj"
  exit 1
fi
echo "✅  Bundle ID: se.catchme.vindkollen"

if ! grep -q "Vindkollen" "$PLIST" 2>/dev/null; then
  echo "❌  Display Name saknas i Info.plist"
  exit 1
fi
echo "✅  Display Name: Vindkollen"

for KEY in NSCameraUsageDescription NSLocationWhenInUseUsageDescription \
           NSMotionUsageDescription NSPhotoLibraryUsageDescription; do
  if ! grep -q "$KEY" "$PLIST" 2>/dev/null; then
    echo "❌  Privacy-nyckel saknas: $KEY"
    exit 1
  fi
done
echo "✅  Privacy-nycklar: kamera, plats, rörelse, fotobibliotek"

# ── 8. cap sync ios ───────────────────────────────────────────────────────────

echo ""
echo "── Steg 7: cap sync ios ──"
cd "$ARTIFACT_DIR"

if ! npx cap sync ios; then
  echo "❌  cap sync ios misslyckades"
  exit 1
fi
echo "✅  cap sync ios klar"

# ── 9. ios-setup.sh (privacy strings) ────────────────────────────────────────

echo ""
echo "── Steg 8: ios-setup.sh ──"
bash "$SCRIPT_DIR/ios-setup.sh"

# ── 10. ios-verify.sh (SPM + bundle-ID) ──────────────────────────────────────

echo ""
echo "── Steg 9: ios-verify.sh ──"
bash "$SCRIPT_DIR/ios-verify.sh"

# ── Klart ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅  ios:prepare KLAR                        ║"
echo "║  Öppna Xcode → Product → Archive             ║"
echo "║  Ladda upp till App Store Connect            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
