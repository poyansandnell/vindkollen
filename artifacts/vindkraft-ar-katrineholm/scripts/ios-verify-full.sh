#!/usr/bin/env bash
# =============================================================================
# ios-verify-full.sh — Vindkollen iOS pre-upload verifiering
#
# Kör från: artifacts/vindkraft-ar-katrineholm/   (eller via pnpm ios:verify)
#
# Verifierar det som faktiskt ska arkiveras och laddas upp till App Store Connect:
#   - disableAudio: true i dist-native (hindrar TCC-krasch)
#   - Ingen NSMicrophoneUsageDescription
#   - Bundle ID = se.catchme.vindkollen (Debug + Release)
#   - Display Name = Vindkollen
#   - Obligatoriska privacy-nycklar finns
#   - SPM + Package.swift (via ios-verify.sh)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ARTIFACT_DIR"

PASS=0
FAIL=0

ok()  { echo "  ✅  $1"; PASS=$((PASS + 1)); }
fail(){ echo "  ❌  $1"; FAIL=$((FAIL + 1)); }

echo ""
echo "=== Vindkollen iOS-verifiering ==="
echo ""

# ── dist-native ───────────────────────────────────────────────────────────────
echo "── dist-native ──"

if [[ -d "dist-native" ]]; then
  ok "dist-native finns"
else
  fail "dist-native saknas — kör: pnpm ios:prepare"
fi

if grep -rq 'disableAudio[: ]*!0\|disableAudio[: ]*true' dist-native/assets/*.js 2>/dev/null; then
  ok "disableAudio: true i dist-native"
else
  fail "disableAudio: true SAKNAS i dist-native"
fi

# ── Mikrofon ──────────────────────────────────────────────────────────────────
echo ""
echo "── Mikrofon (ska EJ finnas) ──"

if grep -r "NSMicrophoneUsageDescription" ios/ scripts/ 2>/dev/null \
   | grep -v "^Binary" | grep -q .; then
  fail "NSMicrophoneUsageDescription hittades — ta bort den!"
else
  ok "Ingen NSMicrophoneUsageDescription"
fi

# ── Bundle ID och Display Name ────────────────────────────────────────────────
echo ""
echo "── Bundle ID och Display Name ──"

PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"
PLIST="ios/App/App/Info.plist"

BUNDLE_COUNT=$(grep -c "se\.catchme\.vindkollen" "$PBXPROJ" 2>/dev/null || echo 0)
if [[ "$BUNDLE_COUNT" -ge 2 ]]; then
  ok "Bundle ID se.catchme.vindkollen (Debug + Release)"
else
  fail "Bundle ID är fel i project.pbxproj ($BUNDLE_COUNT träffar, förväntade ≥2)"
fi

if grep -q "Vindkollen" "$PLIST" 2>/dev/null; then
  ok "Display Name: Vindkollen"
else
  fail "Display Name saknas eller fel i Info.plist"
fi

# ── Privacy-nycklar ───────────────────────────────────────────────────────────
echo ""
echo "── Privacy-nycklar ──"

for KEY in NSCameraUsageDescription \
           NSLocationWhenInUseUsageDescription \
           NSLocationAlwaysAndWhenInUseUsageDescription \
           NSMotionUsageDescription \
           NSPhotoLibraryUsageDescription \
           NSPhotoLibraryAddUsageDescription; do
  if grep -q "$KEY" "$PLIST" 2>/dev/null; then
    ok "$KEY"
  else
    fail "$KEY saknas i Info.plist"
  fi
done

# ── SPM-verifiering (ios-verify.sh) ──────────────────────────────────────────
echo ""
echo "── SPM-verifiering ──"
bash scripts/ios-verify.sh

# ── Sammanfattning ────────────────────────────────────────────────────────────
echo ""
echo "───────────────────────────────────────────────"
echo "Totalt: $PASS godkänd(a), $FAIL misslyckad(e)"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "❌  Verifiering MISSLYCKADES — ladda INTE upp till App Store Connect."
  echo ""
  exit 1
else
  echo "✅  Allt godkänt — redo för Xcode-arkivering."
  echo ""
fi
