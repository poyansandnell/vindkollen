#!/bin/bash
# =============================================================================
# ios-setup.sh — Vindkollen iOS Info.plist privacy strings
#
# Kör detta skript EFTER "cap add ios" på din Mac.
# Det lägger till de obligatoriska privacy usage descriptions som Apple kräver
# för kamera, plats och rörelsedata.
#
# Användning:
#   cd artifacts/vindkraft-ar-katrineholm
#   bash scripts/ios-setup.sh
# =============================================================================

set -e

PLIST="ios/App/App/Info.plist"

if [ ! -f "$PLIST" ]; then
  echo "❌  Hittade inte $PLIST"
  echo "   Kör först: pnpm exec cap add ios"
  exit 1
fi

echo "📝  Lägger till privacy strings i $PLIST …"

/usr/libexec/PlistBuddy -c \
  "Add :NSCameraUsageDescription string 'Vindkollen behöver kameran för att visa vindkraftverken i AR direkt mot horisonten.'" \
  "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c \
  "Set :NSCameraUsageDescription 'Vindkollen behöver kameran för att visa vindkraftverken i AR direkt mot horisonten.'" \
  "$PLIST"

/usr/libexec/PlistBuddy -c \
  "Add :NSLocationWhenInUseUsageDescription string 'Vindkollen använder din plats för att beräkna riktning och avstånd till vindkraftverken.'" \
  "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c \
  "Set :NSLocationWhenInUseUsageDescription 'Vindkollen använder din plats för att beräkna riktning och avstånd till vindkraftverken.'" \
  "$PLIST"

/usr/libexec/PlistBuddy -c \
  "Add :NSMotionUsageDescription string 'Vindkollen använder kompass och rörelsesensorer för att rikta AR-vyn mot rätt horisont.'" \
  "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c \
  "Set :NSMotionUsageDescription 'Vindkollen använder kompass och rörelsesensorer för att rikta AR-vyn mot rätt horisont.'" \
  "$PLIST"

echo "✅  Privacy strings klara:"
echo "   NSCameraUsageDescription"
echo "   NSLocationWhenInUseUsageDescription"
echo "   NSMotionUsageDescription"
echo ""
echo "➡️  Nästa steg: öppna Xcode och verifiera under"
echo "   Vindkollen target → Info → Custom iOS Target Properties"
