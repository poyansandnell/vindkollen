#!/bin/bash
# =============================================================================
# ios-setup.sh — Vindkollen iOS Info.plist privacy strings
#
# Skriver in och verifierar obligatoriska NSUsageDescription-nycklar i
# ios/App/App/Info.plist med PlistBuddy (inbyggt macOS-verktyg).
#
# KÖRS AUTOMATISKT AV:
#   pnpm native:ios          →  efter cap sync ios, före cap open ios
#   pnpm native:sync         →  efter cap sync (alla plattformar)
#   pnpm native:cap-add-ios  →  direkt efter cap add ios
#   pnpm native:plist        →  manuellt, t.ex. vid återställning av ios/
#
# IDEMPOTENT: Add-or-Set — lägger till nyckeln om den saknas,
# uppdaterar värdet om den redan finns. Säkert att köra hur många gånger
# som helst utan risk för duplicering.
#
# VERIFIERING: Efter skrivning läser skriptet tillbaka varje nyckel från
# filen och avslutar med exit 1 om något saknas.
# =============================================================================

set -euo pipefail

# ── Sökväg ────────────────────────────────────────────────────────────────────

PLIST="${PLIST_PATH:-ios/App/App/Info.plist}"
BUDDY="/usr/libexec/PlistBuddy"

# ── Kontroll att filen finns ──────────────────────────────────────────────────

if [ ! -f "$PLIST" ]; then
  echo ""
  echo "❌  Info.plist hittades inte: $PLIST"
  echo "   Kör först: pnpm native:cap-add-ios"
  echo "   (eller: pnpm exec cap add ios && pnpm native:plist)"
  echo ""
  exit 1
fi

# ── Hjälpfunktion: Add-or-Set (idempotent) ────────────────────────────────────

plist_set() {
  local key="$1"
  local value="$2"
  # Försök Add; om nyckeln redan finns ger PlistBuddy exit 1 → kör Set istället
  "$BUDDY" -c "Add :${key} string ${value}" "$PLIST" 2>/dev/null \
    || "$BUDDY" -c "Set :${key} ${value}" "$PLIST"
}

# ── Skriv privacy strings ─────────────────────────────────────────────────────

echo ""
echo "📝  Skriver iOS privacy strings till: $PLIST"
echo ""

plist_set "NSCameraUsageDescription" \
  "Vindkollen behöver använda kameran för att visa vindkraftverken i AR."

plist_set "NSLocationWhenInUseUsageDescription" \
  "Vindkollen behöver din position för att beräkna avstånd och riktning till vindkraftverken."

plist_set "NSMotionUsageDescription" \
  "Vindkollen behöver använda rörelsesensorer och kompass för att visa rätt riktning i AR."

plist_set "NSMicrophoneUsageDescription" \
  "Vindkollen behöver mikrofonbehörighet för kamerafunktionen i AR-läget."

plist_set "NSLocationAlwaysAndWhenInUseUsageDescription" \
  "Vindkollen använder din position för att beräkna avstånd och riktning till vindkraftverken i AR och på kartan. Platsen används medan appen är öppen."

plist_set "NSPhotoLibraryUsageDescription" \
  "Vindkollen behöver tillgång till fotobiblioteket så att du kan spara och dela fotomontage av vindkraftverk i AR."

plist_set "NSPhotoLibraryAddUsageDescription" \
  "Vindkollen behöver spara fotomontage av vindkraftverk till ditt fotobibliotek."

# ── Verifiering: läs tillbaka varje nyckel ────────────────────────────────────

echo "🔍  Verifierar att nycklarna finns i filen …"
echo ""

ERRORS=0

verify_key() {
  local key="$1"
  local label="$2"
  local value
  value=$("$BUDDY" -c "Print :${key}" "$PLIST" 2>/dev/null || echo "")
  if [ -z "$value" ]; then
    echo "   ❌  SAKNAS: $key"
    ERRORS=$((ERRORS + 1))
  else
    echo "   ✅  $label"
  fi
}

verify_key "NSCameraUsageDescription"                        "camera"
verify_key "NSLocationWhenInUseUsageDescription"             "location"
verify_key "NSLocationAlwaysAndWhenInUseUsageDescription"    "location (always)"
verify_key "NSMotionUsageDescription"                        "motion"
verify_key "NSMicrophoneUsageDescription"                    "microphone"
verify_key "NSPhotoLibraryUsageDescription"                  "photo library"
verify_key "NSPhotoLibraryAddUsageDescription"               "photo library add"

echo ""

if [ "$ERRORS" -gt 0 ]; then
  echo "❌  $ERRORS nyckel(ar) saknas i $PLIST — kontrollera PlistBuddy-output ovan."
  exit 1
fi

echo "iOS privacy keys verified: camera, location, motion, microphone, photo"
echo ""
echo "   Verifiera i Xcode: App target → Info → Custom iOS Target Properties"
echo ""
