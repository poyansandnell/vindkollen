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
#   2. Kontrollera att @tailwindcss/oxide laddar sin native binding
#   3. Radera gammal dist-native
#   4. Bygg dist-native — avbryt och håll dist-native raderad om det misslyckas
#   5. Verifiera disableAudio:true i det byggda paketet
#   6. Verifiera att NSMicrophoneUsageDescription INTE finns
#   7. Verifiera Bundle ID och Display Name
#   8. cap sync ios (bara om 3-7 lyckades)
#   9. ios-setup.sh (privacy strings)
#  10. ios-verify.sh (SPM + bundle-ID)
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

# ── 2. Kontrollera @tailwindcss/oxide native binding ─────────────────────────
#
# Testar via node require() från artifact-katalogen så att pnpm:s
# virtual store + workspace-hoisting hanteras korrekt.
# Ingen katalogkontroll — det är om modulen faktiskt laddar som räknas.

echo ""
echo "── Steg 2: native binding ──"

oxide_loads() {
  # Kör node från artifact-dir så att module resolution går via workspace
  node -e "require('@tailwindcss/oxide')" 2>/dev/null
}

cd "$ARTIFACT_DIR"

if ! oxide_loads; then
  echo "⚠️   @tailwindcss/oxide kan inte laddas — kör pnpm install..."
  cd "$MONOREPO_ROOT"
  pnpm install
  cd "$ARTIFACT_DIR"
fi

if ! oxide_loads; then
  echo "❌  @tailwindcss/oxide kan inte laddas efter pnpm install."
  echo "    Prova: rm -rf node_modules && pnpm install"
  exit 1
fi

echo "✅  @tailwindcss/oxide laddar korrekt ($ARCH native binding)"

# ── 3. Radera gammal dist-native ─────────────────────────────────────────────

echo ""
echo "── Steg 3: rensa dist-native ──"
cd "$ARTIFACT_DIR"
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

# ── 5. Verifiera disableAudio:true i bygget ───────────────────────────────────

echo ""
echo "── Steg 5: verifiera disableAudio ──"

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
echo "── Steg 6: mikrofon-verifiering ──"

MICROPHONE_HITS=$(grep -r "NSMicrophoneUsageDescription" \
  "$ARTIFACT_DIR/ios/" "$ARTIFACT_DIR/scripts/" 2>/dev/null \
  | grep -v "^Binary" || true)

if [[ -n "$MICROPHONE_HITS" ]]; then
  echo "❌  NSMicrophoneUsageDescription hittades — ta bort den!"
  echo "$MICROPHONE_HITS"
  exit 1
fi
echo "✅  Ingen NSMicrophoneUsageDescription i ios/ eller scripts/"

# ── 7. Verifiera Bundle ID och Display Name ───────────────────────────────────

echo ""
echo "── Steg 7: Bundle ID och Display Name ──"

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
echo "── Steg 8: cap sync ios ──"
cd "$ARTIFACT_DIR"

if ! npx cap sync ios; then
  echo "❌  cap sync ios misslyckades"
  exit 1
fi
echo "✅  cap sync ios klar"

# ── 9. ios-setup.sh (privacy strings) ────────────────────────────────────────

echo ""
echo "── Steg 9: ios-setup.sh ──"
bash "$SCRIPT_DIR/ios-setup.sh"

# ── 10. ios-verify.sh (SPM + bundle-ID) ──────────────────────────────────────

echo ""
echo "── Steg 10: ios-verify.sh ──"
bash "$SCRIPT_DIR/ios-verify.sh"

# ── Klart ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅  ios:prepare KLAR                        ║"
echo "║  Öppna Xcode → Product → Archive             ║"
echo "║  Ladda upp till App Store Connect            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
