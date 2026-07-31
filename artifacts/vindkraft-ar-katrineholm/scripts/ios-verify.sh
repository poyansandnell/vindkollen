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
echo "  (Lokal vendor-design — inga remote SPM-beroenden, Package.resolved krävs inte)"
check_file "Package.swift finns" "$PKG_SWIFT"
if [ -f "$PKG_SWIFT" ]; then
  # Lokal vendor-sökväg (inte remote exact)
  check "capacitor-swift-pm som lokal path-dependency" \
    'path:.*vendor/capacitor-swift-pm\|path: "vendor/capacitor-swift-pm"' "$PKG_SWIFT"
  check "ion-ios-camera som lokal path-dependency" \
    'path:.*vendor/ion-ios-camera\|path: "vendor/ion-ios-camera"' "$PKG_SWIFT"
  check "ion-ios-geolocation som lokal path-dependency" \
    'path:.*vendor/ion-ios-geolocation\|path: "vendor/ion-ios-geolocation"' "$PKG_SWIFT"
  check "Capacitor produkt-dependency i CapApp-SPM target" \
    'product(name: "Capacitor"' "$PKG_SWIFT"
  check "Cordova produkt-dependency i CapApp-SPM target" \
    'product(name: "Cordova"' "$PKG_SWIFT"
fi

echo ""
echo "── Package.resolved ──"
echo "  (Krävs ej — alla beroenden är lokala vendor-sökvägar)"
if [ -f "$PKG_RESOLVED" ]; then
  echo "  ℹ️   Package.resolved finns (ofarligt, genereras av Xcode vid öppning)"
else
  echo "  ✅  Package.resolved saknas — korrekt för lokal vendor-design"
  PASS=$((PASS + 1))
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
