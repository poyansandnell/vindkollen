#!/usr/bin/env bash
# =============================================================================
# android-release.sh — Vindkollen fullständig release-pipeline för Google Play
#
# Kör bara ett kommando för en färdig signerad .aab:
#   pnpm android:release
#
# Keystoreupplösning (i prioritetsordning):
#   1. android/keystore.properties (om den redan finns och är komplett)
#   2. Miljövariabler: VINDKOLLEN_STORE_FILE, VINDKOLLEN_STORE_PASSWORD,
#                      VINDKOLLEN_KEY_ALIAS, VINDKOLLEN_KEY_PASSWORD
#   3. Automatisk sökning: ~/nycklar/vindkollen-upload.jks
#
# Om en keystore hittas men lösenord saknas frågas du interaktivt (ingen echo).
# android/keystore.properties skapas automatiskt och sparas för framtida körningar.
#
# Steg:
#   1–8.  android:prepare   (bygg, verifiera, cap sync)
#   9.    Keystoreupplösning
#   10.   Verifiera keystore-fil och alias
#   11.   bundleRelease
#   12.   Skriv ut .aab-sökväg
# =============================================================================

set -euo pipefail

SCRIPT_ABS="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_ABS")"
ARTIFACT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       Vindkollen — android:release           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# =============================================================================
# Steg 1–8: android:prepare
# =============================================================================

echo "── Steg 1–8: android:prepare ──"
echo ""

if ! bash "$SCRIPT_DIR/android-prepare.sh"; then
  echo ""
  echo "❌  android:prepare misslyckades — release avbruten."
  exit 1
fi

# =============================================================================
# Steg 9: Keystoreupplösning
# =============================================================================

echo ""
echo "── Steg 9: keystoreupplösning ──"
echo ""

KEYSTORE_PROPS="$ARTIFACT_DIR/android/keystore.properties"

# Funktion: läs ett värde ur keystore.properties
_props_value() {
  local key="$1"
  local file="$2"
  grep -E "^${key}[[:space:]]*=" "$file" 2>/dev/null \
    | head -1 \
    | sed 's/^[^=]*=[[:space:]]*//' \
    | tr -d '\r'
}

# Funktion: fråga om lösenord utan att visa det
_read_password() {
  local prompt="$1"
  local varname="$2"
  # Måste stödja både terminal och icke-interaktiva lägen
  if [[ -t 0 ]]; then
    read -r -s -p "$prompt" "$varname"
    echo ""
  else
    echo "❌  Lösenord saknas och terminalen är inte interaktiv." >&2
    echo "    Sätt miljövariabler eller skapa android/keystore.properties." >&2
    exit 1
  fi
}

STORE_FILE=""
STORE_PASSWORD=""
KEY_ALIAS=""
KEY_PASSWORD=""
PROPS_CREATED=false

# ── Prioritet 1: keystore.properties finns och är komplett ──────────────────

if [[ -f "$KEYSTORE_PROPS" ]]; then
  _SF="$(_props_value storeFile    "$KEYSTORE_PROPS")"
  _SP="$(_props_value storePassword "$KEYSTORE_PROPS")"
  _KA="$(_props_value keyAlias     "$KEYSTORE_PROPS")"
  _KP="$(_props_value keyPassword  "$KEYSTORE_PROPS")"

  if [[ -n "$_SF" && -n "$_SP" && -n "$_KA" && -n "$_KP" ]]; then
    STORE_FILE="$_SF"
    STORE_PASSWORD="$_SP"
    KEY_ALIAS="$_KA"
    KEY_PASSWORD="$_KP"
    echo "✅  Använder keystore.properties"
  else
    echo "⚠️   keystore.properties finns men är ofullständig — söker vidare…"
  fi
fi

# ── Prioritet 2: miljövariabler ──────────────────────────────────────────────

if [[ -z "$STORE_FILE" && -n "${VINDKOLLEN_STORE_FILE:-}" ]]; then
  STORE_FILE="${VINDKOLLEN_STORE_FILE}"
  KEY_ALIAS="${VINDKOLLEN_KEY_ALIAS:-vindkollen}"

  if [[ -n "${VINDKOLLEN_STORE_PASSWORD:-}" ]]; then
    STORE_PASSWORD="${VINDKOLLEN_STORE_PASSWORD}"
  else
    _read_password "🔑  Store-lösenord (VINDKOLLEN_STORE_PASSWORD): " STORE_PASSWORD
  fi

  if [[ -n "${VINDKOLLEN_KEY_PASSWORD:-}" ]]; then
    KEY_PASSWORD="${VINDKOLLEN_KEY_PASSWORD}"
  else
    _read_password "🔑  Nyckellösenord (VINDKOLLEN_KEY_PASSWORD): " KEY_PASSWORD
  fi

  echo "✅  Keystore hämtad från miljövariabler"
fi

# ── Prioritet 3: automatisk sökning efter ~/nycklar/vindkollen-upload.jks ───

if [[ -z "$STORE_FILE" ]]; then
  CANDIDATE="$HOME/nycklar/vindkollen-upload.jks"
  if [[ -f "$CANDIDATE" ]]; then
    echo "🔍  Hittade: $CANDIDATE"
    STORE_FILE="$CANDIDATE"
    KEY_ALIAS="vindkollen"
    _read_password "🔑  Store-lösenord för $(basename "$CANDIDATE"): " STORE_PASSWORD
    _read_password "🔑  Nyckellösenord (Enter = samma som store): "   KEY_PASSWORD_TMP
    KEY_PASSWORD="${KEY_PASSWORD_TMP:-$STORE_PASSWORD}"
    echo "✅  Keystore hittad automatiskt"
  fi
fi

# ── Inget hittades ────────────────────────────────────────────────────────────

if [[ -z "$STORE_FILE" ]]; then
  echo ""
  echo "❌  Ingen keystore hittades."
  echo ""
  echo "    Skapa en (kör EN gång på Mac):"
  echo "      mkdir -p ~/nycklar"
  echo "      keytool -genkeypair -v -storetype PKCS12 \\"
  echo "        -keystore ~/nycklar/vindkollen-upload.jks \\"
  echo "        -alias vindkollen -keyalg RSA -keysize 2048 -validity 10000"
  echo ""
  echo "    Kör sedan: pnpm android:release"
  echo ""
  echo "    Eller sätt miljövariabler:"
  echo "      export VINDKOLLEN_STORE_FILE=~/nycklar/vindkollen-upload.jks"
  echo "      export VINDKOLLEN_STORE_PASSWORD=lösenord"
  echo "      export VINDKOLLEN_KEY_ALIAS=vindkollen"
  echo "      export VINDKOLLEN_KEY_PASSWORD=lösenord"
  exit 1
fi

# ── Spara keystore.properties om den saknas eller var ofullständig ─────────

if [[ ! -f "$KEYSTORE_PROPS" ]]; then
  cat > "$KEYSTORE_PROPS" <<PROPS
# Automatiskt skapad av android:release $(date '+%Y-%m-%d %H:%M')
# Filen är gitignorerad — committa den ALDRIG.
storeFile=${STORE_FILE}
storePassword=${STORE_PASSWORD}
keyAlias=${KEY_ALIAS}
keyPassword=${KEY_PASSWORD}
PROPS
  PROPS_CREATED=true
  echo "✅  android/keystore.properties skapad"
fi

# =============================================================================
# Steg 10: Verifiera keystore-fil och alias
# =============================================================================

echo ""
echo "── Steg 10: verifiera keystore ──"
echo ""

# Expandera ~ i sökvägen (gradle läser den inte annars)
STORE_FILE_EXP="${STORE_FILE/#\~/$HOME}"

if [[ ! -f "$STORE_FILE_EXP" ]]; then
  echo "❌  Keystore-filen finns inte: $STORE_FILE_EXP"
  echo "    Skapa den med keytool — se docs/android-signing.md"
  exit 1
fi
echo "✅  Keystore-fil: $STORE_FILE_EXP"

# Verifiera att alias faktiskt finns i keystoren
echo "    Kontrollerar alias '$KEY_ALIAS'…"
if keytool -list \
    -keystore "$STORE_FILE_EXP" \
    -storepass "$STORE_PASSWORD" \
    -alias "$KEY_ALIAS" \
    -storetype PKCS12 \
    > /dev/null 2>&1; then
  echo "✅  Alias '$KEY_ALIAS' verifierat"
else
  # Försök utan -storetype om PKCS12 misslyckas (JKS-filer)
  if keytool -list \
      -keystore "$STORE_FILE_EXP" \
      -storepass "$STORE_PASSWORD" \
      -alias "$KEY_ALIAS" \
      > /dev/null 2>&1; then
    echo "✅  Alias '$KEY_ALIAS' verifierat (JKS)"
  else
    echo "❌  Alias '$KEY_ALIAS' hittades inte i keystoren, eller fel lösenord."
    echo "    Kontrollera storePassword och keyAlias i keystore.properties."
    [[ "$PROPS_CREATED" == true ]] && rm -f "$KEYSTORE_PROPS"
    exit 1
  fi
fi

# =============================================================================
# Steg 11: bundleRelease
# =============================================================================

echo ""
echo "── Steg 11: ./gradlew bundleRelease ──"
echo ""

cd "$ARTIFACT_DIR/android"

if [[ ! -f "./gradlew" ]]; then
  echo "❌  gradlew saknas i android/ — är projektet initialiserat?"
  exit 1
fi

chmod +x ./gradlew

# Exportera signeringsvärden som env-variabler ifall build.gradle läser dem
export VINDKOLLEN_STORE_FILE="$STORE_FILE_EXP"
export VINDKOLLEN_STORE_PASSWORD="$STORE_PASSWORD"
export VINDKOLLEN_KEY_ALIAS="$KEY_ALIAS"
export VINDKOLLEN_KEY_PASSWORD="$KEY_PASSWORD"

"./gradlew" bundleRelease

# =============================================================================
# Steg 12: Verifiera och rapportera .aab
# =============================================================================

AAB="$ARTIFACT_DIR/android/app/build/outputs/bundle/release/app-release.aab"

if [[ ! -f "$AAB" ]]; then
  echo ""
  echo "❌  .aab-filen hittades inte på förväntad sökväg:"
  echo "    $AAB"
  exit 1
fi

echo ""
echo "── Steg 12: verifiera faktisk AAB ──"
if ! bash "$SCRIPT_DIR/android-inspect-aab.sh" "$AAB"; then
  echo "❌  AAB-innehållsverifiering misslyckades — release avbruten."
  exit 1
fi

SIZE=$(du -sh "$AAB" | cut -f1)
CREATED_AT=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$AAB" 2>/dev/null \
          || stat -c "%y" "$AAB" 2>/dev/null | cut -c1-16 \
          || echo "okänd tid")

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅  android:release KLAR                    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Fil:     $AAB"
echo "  Storlek: $SIZE   ($CREATED_AT)"
echo ""
echo "  Ladda upp till Google Play Console:"
echo "  Release → Production → Create new release → Upload"
echo ""
