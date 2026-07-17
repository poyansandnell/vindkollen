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
check "Bundle ID satt till se.vindkollen.app" \
  'PRODUCT_BUNDLE_IDENTIFIER = se\.vindkollen\.app' "$PBXPROJ"
check_absent "INGEN direkt XCRemoteSwiftPackageReference för capacitor-swift-pm" \
  'XCRemoteSwiftPackageReference "capacitor-swift-pm"' "$PBXPROJ"
check_absent "INGET direkt Capacitor-produktberoende i pbxproj (ska gå via CapApp-SPM)" \
  'productName = Capacitor;' "$PBXPROJ"

echo ""
echo "── CapApp-SPM/Package.swift ──"
check_file "Package.swift finns" "$PKG_SWIFT"
if [ -f "$PKG_SWIFT" ]; then
  check "capacitor-swift-pm exact 8.4.2" \
    'capacitor-swift-pm.*exact.*8\.4\.2\|exact.*8\.4\.2.*capacitor-swift-pm' "$PKG_SWIFT"
  check "Capacitor produkt-dependency i CapApp-SPM target" \
    'product(name: "Capacitor"' "$PKG_SWIFT"
  check "Cordova produkt-dependency i CapApp-SPM target" \
    'product(name: "Cordova"' "$PKG_SWIFT"
fi

echo ""
echo "── Package.resolved ──"
check_file "Package.resolved finns" "$PKG_RESOLVED"
if [ -f "$PKG_RESOLVED" ]; then
  check "capacitor-swift-pm pinnad" \
    '"capacitor-swift-pm"' "$PKG_RESOLVED"
  check "ion-ios-camera pinnad" \
    '"ion-ios-camera"' "$PKG_RESOLVED"
  check "ion-ios-geolocation pinnad" \
    '"ion-ios-geolocation"' "$PKG_RESOLVED"
fi

echo ""
echo "── pnpm virtual store-sökvägar (Package.swift lokala paket) ──"
if [ -f "$PKG_SWIFT" ]; then
  while IFS= read -r path_line; do
    rel_path=$(echo "$path_line" | grep -oE '"[^"]*node_modules[^"]*"' | tr -d '"' || true)
    if [ -n "$rel_path" ]; then
      real_path=$(cd "$ARTIFACT_DIR/ios/App/CapApp-SPM" && realpath "$rel_path" 2>/dev/null || echo "")
      if [ -d "$real_path" ]; then
        echo "  ✅  Lokal sökväg OK: $rel_path"
        PASS=$((PASS + 1))
      else
        echo "  ❌  Lokal sökväg saknas: $rel_path"
        echo "       → Kör: pnpm install (från monorepo-roten)"
        FAIL=$((FAIL + 1))
      fi
    fi
  done < <(grep 'path:' "$PKG_SWIFT")
fi

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
