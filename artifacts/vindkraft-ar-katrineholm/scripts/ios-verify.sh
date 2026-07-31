#!/usr/bin/env bash
# Verifierar att iOS-projektet har korrekta Swift Package-kopplingar
# Kör från: artifacts/vindkraft-ar-katrineholm/
# Används av: pnpm native:ios:verify

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PBXPROJ="$ARTIFACT_DIR/ios/App/App.xcodeproj/project.pbxproj"
PKG_SWIFT="$ARTIFACT_DIR/ios/App/CapApp-SPM/Package.swift"
PKG_RESOLVED="$ARTIFACT_DIR/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"

PASS=0
FAIL=0

check() {
  local desc="$1"
  local pattern="$2"
  local file="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  ✅  $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌  $desc"
    FAIL=$((FAIL + 1))
  fi
}

check_absent() {
  local desc="$1"
  local pattern="$2"
  local file="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  ❌  $desc (hittades — ska EJ finnas)"
    FAIL=$((FAIL + 1))
  else
    echo "  ✅  $desc (frånvarande — korrekt)"
    PASS=$((PASS + 1))
  fi
}

check_file() {
  local desc="$1"
  local file="$2"
  if [ -f "$file" ]; then
    echo "  ✅  $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌  $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== iOS SPM-verifiering ==="
echo ""

echo "── project.pbxproj ──"
echo "  (Ska matcha officiell Capacitor 8.x SPM-template: enbart CapApp-SPM)"
check "XCLocalSwiftPackageReference för CapApp-SPM" \
  'XCLocalSwiftPackageReference "CapApp-SPM"' "$PBXPROJ"
check "CapApp-SPM produktberoende (XCSwiftPackageProductDependency)" \
  'productName = "CapApp-SPM"' "$PBXPROJ"
check "CapApp-SPM länkad i Frameworks Build Phase" \
  'CapApp-SPM in Frameworks' "$PBXPROJ"
check "Bundle ID satt till se.catchme.vindkollen" \
  'PRODUCT_BUNDLE_IDENTIFIER = se\.catchme\.vindkollen' "$PBXPROJ"
check_absent "INGEN direkt XCRemoteSwiftPackageReference för capacitor-swift-pm" \
  'XCRemoteSwiftPackageReference "capacitor-swift-pm"' "$PBXPROJ"
check_absent "INGET direkt Capacitor-produktberoende i pbxproj (ska gå via CapApp-SPM)" \
  'productName = Capacitor;' "$PBXPROJ"

echo ""
echo "── CapApp-SPM/Package.swift ──"
echo "  (Genereras av fix-ios-package-swift.js efter cap sync)"
check_file "Package.swift finns" "$PKG_SWIFT"
if [ -f "$PKG_SWIFT" ]; then
  # capacitor-swift-pm: lokal vendor/ path (fast sträng, -F säker på BSD+GNU grep)
  if grep -Fq 'path: "vendor/capacitor-swift-pm"' "$PKG_SWIFT"; then
    echo "  ✅  capacitor-swift-pm som lokal path-dependency"
    PASS=$((PASS + 1))
  else
    echo "  ❌  capacitor-swift-pm som lokal path-dependency"
    FAIL=$((FAIL + 1))
  fi

  # ion-ios-camera: remote URL (fix-ios skriver url:, inte path:)
  if grep -Fq 'ion-ios-camera' "$PKG_SWIFT"; then
    echo "  ✅  ion-ios-camera dependency finns"
    PASS=$((PASS + 1))
  else
    echo "  ❌  ion-ios-camera dependency saknas"
    FAIL=$((FAIL + 1))
  fi

  # ion-ios-geolocation: remote URL
  if grep -Fq 'ion-ios-geolocation' "$PKG_SWIFT"; then
    echo "  ✅  ion-ios-geolocation dependency finns"
    PASS=$((PASS + 1))
  else
    echo "  ❌  ion-ios-geolocation dependency saknas"
    FAIL=$((FAIL + 1))
  fi

  # Produktanvändning i targets
  if grep -Fq 'product(name: "Capacitor"' "$PKG_SWIFT"; then
    echo "  ✅  Capacitor produkt-dependency"
    PASS=$((PASS + 1))
  else
    echo "  ❌  Capacitor produkt-dependency saknas"
    FAIL=$((FAIL + 1))
  fi

  if grep -Fq 'product(name: "Cordova"' "$PKG_SWIFT"; then
    echo "  ✅  Cordova produkt-dependency"
    PASS=$((PASS + 1))
  else
    echo "  ❌  Cordova produkt-dependency saknas"
    FAIL=$((FAIL + 1))
  fi

  if grep -Fq 'product(name: "IONCameraLib"' "$PKG_SWIFT"; then
    echo "  ✅  IONCameraLib produkt-dependency"
    PASS=$((PASS + 1))
  else
    echo "  ❌  IONCameraLib produkt-dependency saknas"
    FAIL=$((FAIL + 1))
  fi

  if grep -Fq 'product(name: "IONGeolocationLib"' "$PKG_SWIFT"; then
    echo "  ✅  IONGeolocationLib produkt-dependency"
    PASS=$((PASS + 1))
  else
    echo "  ❌  IONGeolocationLib produkt-dependency saknas"
    FAIL=$((FAIL + 1))
  fi
fi

echo ""
echo "── Package.resolved ──"
if [ -f "$PKG_RESOLVED" ]; then
  echo "  ℹ️   Package.resolved finns (genereras av Xcode — ofarligt)"
else
  echo "  ℹ️   Package.resolved saknas (skapas av Xcode vid första öppning)"
fi

echo ""
echo "── Lokala vendor-kataloger ──"
CAPAPP_SPM_DIR="$ARTIFACT_DIR/ios/App/CapApp-SPM"
for vendor_dir in \
    "vendor/capacitor-swift-pm" \
    "vendor/ion-ios-camera" \
    "vendor/ion-ios-geolocation"; do
  full_path="$CAPAPP_SPM_DIR/$vendor_dir"
  if [ -d "$full_path" ]; then
    echo "  ✅  $vendor_dir"
    PASS=$((PASS + 1))
  else
    echo "  ❌  $vendor_dir saknas (kör: git pull)"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "───────────────────────────────"
echo "Resultat: $PASS godkänd(a), $FAIL misslyckad(e)"
echo ""

if [ $FAIL -gt 0 ]; then
  echo "❌  Verifiering MISSLYCKADES."
  echo ""
  echo "Vanliga åtgärder:"
  echo "  • Saknade pnpm-sökvägar  → kör: pnpm install  (från monorepo-roten)"
  echo "  • Felaktig pbxproj       → kör: git checkout -- ios/App/App.xcodeproj/project.pbxproj"
  echo "  • Package.swift är gammal → kör: pnpm --filter @workspace/vindkraft-ar-katrineholm exec cap sync ios"
  echo ""
  exit 1
else
  echo "✅  Alla kontroller godkända. Projektet är redo för Xcode."
  echo ""
fi
