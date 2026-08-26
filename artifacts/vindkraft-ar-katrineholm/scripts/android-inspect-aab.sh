#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# android-inspect-aab.sh — verifies the actual contents of a built Android AAB.
# It intentionally checks the packaged files, not just their source copies.
# -----------------------------------------------------------------------------

set -euo pipefail

SCRIPT_ABS="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_ABS")"
ARTIFACT_DIR="$(dirname "$SCRIPT_DIR")"
AAB="${1:-$ARTIFACT_DIR/android/app/build/outputs/bundle/release/app-release.aab}"
EXPECTED_VERSION_CODE=8
EXPECTED_VERSION_NAME="1.1"

PASS=0
FAIL=0
ok()   { echo "  ✅  $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌  $1"; FAIL=$((FAIL + 1)); }

if [[ ! -f "$AAB" ]]; then
  echo "❌  AAB saknas: $AAB"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo ""
echo "=== Vindkollen AAB-innehållsverifiering ==="
echo "  Fil: $AAB"
echo ""

ENTRY_LIST="$TMP_DIR/aab-entries.txt"
unzip -Z1 "$AAB" > "$ENTRY_LIST"

require_entry() {
  local entry="$1"
  if grep -Fxq "$entry" "$ENTRY_LIST"; then
    ok "AAB innehåller $entry"
  else
    fail "AAB saknar $entry"
  fi
}

require_entry "base/manifest/AndroidManifest.xml"
require_entry "base/assets/capacitor.plugins.json"
require_entry "base/assets/public/index.html"

echo ""
echo "── Paketadata ──"
unzip -p "$AAB" "base/manifest/AndroidManifest.xml" > "$TMP_DIR/AndroidManifest.xml"
(
  cd "$TMP_DIR"
  zip -q manifest-only.apk AndroidManifest.xml
)

SDK_DIR=""
if [[ -f "$ARTIFACT_DIR/android/local.properties" ]]; then
  SDK_DIR="$(sed -n 's#^sdk\.dir=##p' "$ARTIFACT_DIR/android/local.properties" | head -1)"
fi
SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$SDK_DIR}}"
AAPT2=""
if [[ -n "$SDK_DIR" && -d "$SDK_DIR/build-tools" ]]; then
  AAPT2="$(find "$SDK_DIR/build-tools" -type f -name aapt2 -perm -u+x 2>/dev/null | sort -V | tail -1)"
fi

if [[ -n "$AAPT2" && -x "$AAPT2" ]]; then
  "$AAPT2" dump xmltree "$TMP_DIR/manifest-only.apk" --file AndroidManifest.xml > "$TMP_DIR/manifest-tree.txt"
  if grep -Fq 'package="se.catchme.vindkollen"' "$TMP_DIR/manifest-tree.txt"; then
    ok "AAB package name är se.catchme.vindkollen"
  else
    fail "AAB package name är inte se.catchme.vindkollen"
  fi
  if grep -Fq "versionCode(0x0101021b)=$EXPECTED_VERSION_CODE (Raw: \"$EXPECTED_VERSION_CODE\")" "$TMP_DIR/manifest-tree.txt" && \
     grep -Fq "versionName(0x0101021c)=\"$EXPECTED_VERSION_NAME\" (Raw: \"$EXPECTED_VERSION_NAME\")" "$TMP_DIR/manifest-tree.txt"; then
    ok "AAB version är $EXPECTED_VERSION_NAME (versionCode $EXPECTED_VERSION_CODE)"
  else
    fail "AAB har inte förväntad version $EXPECTED_VERSION_NAME (versionCode $EXPECTED_VERSION_CODE)"
  fi
else
  fail "Kunde inte hitta aapt2 för att verifiera AAB:s paketadata"
fi

echo ""
echo "── Inbäddad webbbundle ──"
unzip -p "$AAB" "base/assets/public/index.html" > "$TMP_DIR/index.html"
if cmp -s "$ARTIFACT_DIR/dist-native/index.html" "$TMP_DIR/index.html"; then
  ok "AAB använder exakt aktuell dist-native/index.html"
else
  fail "AAB:s index.html skiljer sig från aktuell dist-native — bygg om via pnpm android:bundle"
fi

while IFS= read -r asset; do
  asset="${asset#/assets/}"
  if grep -Fxq "base/assets/public/assets/$asset" "$ENTRY_LIST"; then
    ok "AAB innehåller aktuell asset: $asset"
  else
    fail "AAB saknar asset som index.html refererar till: $asset"
  fi
done < <(grep -oE '/assets/[^"[:space:]]+' "$TMP_DIR/index.html" | sort -u)

echo ""
echo "── Android-kamerapluggar ──"
unzip -p "$AAB" "base/assets/capacitor.plugins.json" > "$TMP_DIR/capacitor.plugins.json"
if grep -Eq '@capacitor/camera|camera-preview|CameraPlugin|CameraPreview' "$TMP_DIR/capacitor.plugins.json"; then
  fail "AAB registrerar fortfarande en native kameraplugin"
else
  ok "AAB registrerar inga native kamerapluggar"
fi

echo ""
echo "── Launcher- och splashresurser ──"
if grep -Eq '^base/res/mipmap-.*/ic_launcher(\.png|\.xml)$' "$ENTRY_LIST" && \
   grep -Eq '^base/res/mipmap-.*/ic_launcher_round(\.png|\.xml)$' "$ENTRY_LIST" && \
   grep -Eq '^base/res/mipmap-.*/ic_launcher_foreground\.png$' "$ENTRY_LIST"; then
  ok "AAB innehåller launcher-, round- och foreground-resurser"
else
  fail "AAB saknar en eller flera launcherresurser"
fi

if grep -Fxq 'base/res/mipmap-anydpi-v26/ic_launcher.xml' "$ENTRY_LIST" && \
   grep -Fxq 'base/res/mipmap-anydpi-v26/ic_launcher_round.xml' "$ENTRY_LIST"; then
  ok "AAB innehåller båda adaptive-icon XML-resurserna"
else
  fail "AAB saknar en eller flera adaptive-icon XML-resurser"
fi

echo ""
echo "── Byteverifiering av paketerade launcher-ikoner ──"
for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  for name in ic_launcher ic_launcher_round ic_launcher_foreground; do
    entry="base/res/mipmap-${density}-v4/${name}.png"
    expected="$ARTIFACT_DIR/android/app/src/main/res/mipmap-${density}/${name}.png"
    extracted="$TMP_DIR/${density}-${name}.png"
    if grep -Fxq "$entry" "$ENTRY_LIST" && [[ -f "$expected" ]]; then
      unzip -p "$AAB" "$entry" > "$extracted"
      if cmp -s "$expected" "$extracted"; then
        ok "$density/$name.png matchar exakt AAB-innehållet"
      else
        fail "$density/$name.png skiljer sig mellan källa och AAB"
      fi
    else
      fail "AAB eller källprojekt saknar $density/$name.png"
    fi
  done
done

ANDROID_ICON_ENTRY="base/assets/public/android/icon-512.png"
ANDROID_ICON_SOURCE="$ARTIFACT_DIR/public/android/icon-512.png"
if grep -Fxq "$ANDROID_ICON_ENTRY" "$ENTRY_LIST" && [[ -f "$ANDROID_ICON_SOURCE" ]]; then
  unzip -p "$AAB" "$ANDROID_ICON_ENTRY" > "$TMP_DIR/android-icon-512.png"
  if cmp -s "$ANDROID_ICON_SOURCE" "$TMP_DIR/android-icon-512.png"; then
    ok "AAB:s Android Play-ikon matchar aktuell Vindkollen-källa"
  else
    fail "AAB:s Android Play-ikon skiljer sig från aktuell källa"
  fi
else
  fail "AAB saknar Android Play-ikonens paketerade källa"
fi

if grep -Eq '^base/res/drawable.*/vindkollen_splash\.xml$' "$ENTRY_LIST"; then
  ok "AAB innehåller Vindkollen-splashresursen"
else
  fail "AAB saknar Vindkollen-splashresursen"
fi

if grep -Eq '/splash\.png$' "$ENTRY_LIST"; then
  fail "AAB innehåller en äldre splash.png"
else
  ok "AAB innehåller ingen äldre splash.png"
fi

echo ""
echo "───────────────────────────────────────────────"
echo "Totalt: $PASS godkänd(a), $FAIL misslyckad(e)"

if [[ "$FAIL" -gt 0 ]]; then
  echo "❌  AAB-innehållsverifiering MISSLYCKADES — ladda inte upp filen."
  exit 1
fi

echo "✅  AAB-innehållsverifiering godkänd."