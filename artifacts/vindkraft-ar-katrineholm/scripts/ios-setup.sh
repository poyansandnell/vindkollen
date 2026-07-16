#!/bin/bash
# =============================================================================
# ios-setup.sh — Vindkollen iOS Info.plist privacy strings
#
# Skriver in obligatoriska NSUsageDescription-nycklar i
# ios/App/App/Info.plist med PlistBuddy (macOS-verktyg).
#
# Körs automatiskt av:
#   pnpm native:ios   (efter cap sync ios, före cap open ios)
#   pnpm native:plist (manuellt, t.ex. efter cap add ios)
#
# Körs manuellt om du återskapar ios/-mappen:
#   cd artifacts/vindkraft-ar-katrineholm
#   bash scripts/ios-setup.sh
#
# Skriptet är idempotent — Add-or-Set: lägger till nyckeln om den saknas,
# uppdaterar värdet om den redan finns. Säkert att köra flera gånger.
# =============================================================================

set -e

PLIST="ios/App/App/Info.plist"

if [ ! -f "$PLIST" ]; then
  echo "❌  Hittade inte $PLIST"
  echo "   Kör först: pnpm exec cap add ios"
  exit 1
fi

echo "📝  Skriver privacy strings till $PLIST …"

# NSCameraUsageDescription
/usr/libexec/PlistBuddy -c \
  "Add :NSCameraUsageDescription string 'Vindkollen behöver använda kameran för att visa vindkraftverken i AR.'" \
  "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c \
  "Set :NSCameraUsageDescription 'Vindkollen behöver använda kameran för att visa vindkraftverken i AR.'" \
  "$PLIST"

# NSLocationWhenInUseUsageDescription
/usr/libexec/PlistBuddy -c \
  "Add :NSLocationWhenInUseUsageDescription string 'Vindkollen behöver din position för att beräkna avstånd och riktning till vindkraftverken.'" \
  "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c \
  "Set :NSLocationWhenInUseUsageDescription 'Vindkollen behöver din position för att beräkna avstånd och riktning till vindkraftverken.'" \
  "$PLIST"

# NSMotionUsageDescription
/usr/libexec/PlistBuddy -c \
  "Add :NSMotionUsageDescription string 'Vindkollen behöver använda rörelsesensorer och kompass för att visa rätt riktning i AR.'" \
  "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c \
  "Set :NSMotionUsageDescription 'Vindkollen behöver använda rörelsesensorer och kompass för att visa rätt riktning i AR.'" \
  "$PLIST"

# NSMicrophoneUsageDescription
# Krävs av @capacitor-community/camera-preview på iOS — plugin begär
# mikrofonbehörighet även om appen inte spelar in ljud.
/usr/libexec/PlistBuddy -c \
  "Add :NSMicrophoneUsageDescription string 'Vindkollen behöver mikrofontillstånd för kamerafunktionen i AR-vyn.'" \
  "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c \
  "Set :NSMicrophoneUsageDescription 'Vindkollen behöver mikrofontillstånd för kamerafunktionen i AR-vyn.'" \
  "$PLIST"

echo "✅  Privacy strings klara:"
echo "   NSCameraUsageDescription"
echo "   NSLocationWhenInUseUsageDescription"
echo "   NSMotionUsageDescription"
echo "   NSMicrophoneUsageDescription"
echo ""
echo "   Verifiera i Xcode: App target → Info → Custom iOS Target Properties"
