#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# generate-android-icons.sh — Generate every Android launcher asset from the
# confirmed Vindkollen Play Store icon source.
#
# The source image is intentionally kept outside Android's generated folders.
# Running this script is safe and deterministic; it overwrites only the
# Android-specific launcher PNGs and the Android Play marketing icon copy.
# -----------------------------------------------------------------------------

set -euo pipefail

SCRIPT_ABS="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_ABS")"
ARTIFACT_DIR="$(dirname "$SCRIPT_DIR")"
MONOREPO_ROOT="$(git -C "$ARTIFACT_DIR" rev-parse --show-toplevel)"

SOURCE="$MONOREPO_ROOT/attached_assets/Appikon_1786292388892.png"
RES_DIR="$ARTIFACT_DIR/android/app/src/main/res"
ANDROID_PUBLIC_ICON="$ARTIFACT_DIR/public/android/icon-512.png"

if [[ ! -f "$SOURCE" ]]; then
  echo "❌  Bekräftad ikonkälla saknas: $SOURCE"
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  IMAGE_TOOL=(magick)
elif command -v convert >/dev/null 2>&1; then
  IMAGE_TOOL=(convert)
else
  echo "❌  ImageMagick (magick eller convert) krävs för att generera Android-ikoner."
  exit 1
fi

resize_png() {
  local size="$1"
  local output="$2"
  mkdir -p "$(dirname "$output")"
  "${IMAGE_TOOL[@]}" "$SOURCE" \
    -alpha on \
    -filter Lanczos \
    -resize "${size}x${size}" \
    -strip \
    -define png:color-type=6 \
    "$output"
}

# Legacy launcher icons are the exact rounded Vindkollen icon at the Android
# launcher density sizes. Round and non-round references intentionally match.
declare -A LEGACY_SIZES=(
  [mdpi]=48
  [hdpi]=72
  [xhdpi]=96
  [xxhdpi]=144
  [xxxhdpi]=192
)

# Adaptive foreground uses Android's 108dp adaptive-icon canvas equivalents.
# The white rounded plate is part of the confirmed source; the adaptive XML
# supplies the same white background underneath it.
declare -A FOREGROUND_SIZES=(
  [mdpi]=108
  [hdpi]=162
  [xhdpi]=216
  [xxhdpi]=324
  [xxxhdpi]=432
)

for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  resize_png "${LEGACY_SIZES[$density]}" \
    "$RES_DIR/mipmap-$density/ic_launcher.png"
  resize_png "${LEGACY_SIZES[$density]}" \
    "$RES_DIR/mipmap-$density/ic_launcher_round.png"
  resize_png "${FOREGROUND_SIZES[$density]}" \
    "$RES_DIR/mipmap-$density/ic_launcher_foreground.png"
done

# This is the Android-specific Play marketing icon copied into the web bundle.
# Keep it in sync with the native launcher source, too.
resize_png 512 "$ANDROID_PUBLIC_ICON"

echo "✅  Android-launcherresurser genererade från:"
echo "    $SOURCE"