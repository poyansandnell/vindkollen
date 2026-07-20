# V41 – Replit Agent: Byt Bundle ID till App Store

**Endast Bundle ID.** Inga AR-ändringar, inga UI-ändringar, inget Expo.

## Bakgrund

- Apple Developer (team **Catch Me AB**, `6U878L5X84`) kunde **inte** registrera `se.vindkollen.app` — globalt upptaget ("An App ID with Identifier 'se.vindkollen.app' is not available").
- Nytt, registrerat App ID under Catch Me AB:
  - **Name:** Vindkollen  
  - **Bundle ID:** `se.catchme.vindkollen`

Utan denna ändring kan Xcode / App Store Connect **inte** signera eller ta emot builden.

## Mål

Byt **överallt** i native-konfig:

| Före | Efter |
|------|--------|
| `se.vindkollen.app` | `se.catchme.vindkollen` |

Display-namn förblir **Vindkollen**. App-logik orörd.

Kodbas: `artifacts/vindkraft-ar-katrineholm/`

---

## Filändringar

### 1. `capacitor.config.ts`

```ts
// FÖRE
appId: "se.vindkollen.app",

// EFTER
appId: "se.catchme.vindkollen",
```

`appName: "Vindkollen"` lämnas orörd.

### 2. `ios/App/App.xcodeproj/project.pbxproj`

Byt **båda** förekomsterna (Debug + Release):

```
PRODUCT_BUNDLE_IDENTIFIER = se.vindkollen.app;
```
→
```
PRODUCT_BUNDLE_IDENTIFIER = se.catchme.vindkollen;
```

### 3. `scripts/ios-verify.sh`

```bash
# FÖRE
check "Bundle ID satt till se.vindkollen.app" \
  'PRODUCT_BUNDLE_IDENTIFIER = se\.vindkollen\.app' "$PBXPROJ"

# EFTER
check "Bundle ID satt till se.catchme.vindkollen" \
  'PRODUCT_BUNDLE_IDENTIFIER = se\.catchme\.vindkollen' "$PBXPROJ"
```

### 4. `docs/native-setup.md` (dokumentation)

```
**Bundle ID:** `se.vindkollen.app`
```
→
```
**Bundle ID:** `se.catchme.vindkollen`
```

(Om det finns fler nämningar av det gamla ID:t i samma fil — uppdatera dem också.)

### 5. Android (om mappen finns)

Om `android/` har `applicationId` / `namespace` = `se.vindkollen.app`, byt till `se.catchme.vindkollen` så iOS och Android håller samma package. Finns ingen android-folder än: hoppa över.

### 6. Info.plist URL-typ (valfritt men bra)

I `ios/App/App/Info.plist` finns:

```xml
<key>CFBundleURLName</key>
<string>com.vindkollen.app</string>
```

Byt till:

```xml
<string>se.catchme.vindkollen</string>
```

**URL-schemat** `vindkollen://` (CFBundleURLSchemes) ska **inte** ändras — det är deep-link-nämet, inte Bundle ID.

---

## Verifiering

```bash
cd artifacts/vindkraft-ar-katrineholm

# Inga gamla ID-kvar i app-kod (ignorera attached_assets / historik)
rg -n 'se\.vindkollen\.app' capacitor.config.ts \
  ios/App/App.xcodeproj/project.pbxproj \
  scripts/ios-verify.sh \
  docs/native-setup.md \
  android 2>/dev/null || true

# Ska hitta det nya
rg -n 'se\.catchme\.vindkollen' capacitor.config.ts \
  ios/App/App.xcodeproj/project.pbxproj \
  scripts/ios-verify.sh

pnpm native:ios:verify   # om skriptet funkar i miljön
```

Inga `se.vindkollen.app` kvar i filerna ovan.

---

## Commit (endast dessa filer)

```bash
git add \
  artifacts/vindkraft-ar-katrineholm/capacitor.config.ts \
  artifacts/vindkraft-ar-katrineholm/ios/App/App.xcodeproj/project.pbxproj \
  artifacts/vindkraft-ar-katrineholm/scripts/ios-verify.sh \
  artifacts/vindkraft-ar-katrineholm/docs/native-setup.md \
  artifacts/vindkraft-ar-katrineholm/ios/App/App/Info.plist

# + android-filer om ändrade

git commit -m "V41: change iOS Bundle ID to se.catchme.vindkollen (App Store)"
```

Committeda **inte** REPLIT_AGENT_*.md.

---

## Efter commit — vad ägaren gör lokalt (dokumentera i commit-meddelande eller svar)

1. `pnpm native:ios` (eller `native:sync` + öppna Xcode)
2. Xcode → Signing & Capabilities → Team **Catch Me AB** → Bundle ID ska visa `se.catchme.vindkollen`
3. App Store Connect → **My Apps → + → New App** → Bundle ID `se.catchme.vindkollen`
4. Product → Archive → Distribute → App Store Connect

---

## Rör inte

- Expo / React Native-migrering
- AR-scen, Home.tsx visibility, V39–V40-logik
- appName / CFBundleDisplayName **Vindkollen**
- Deep-link-schemat `vindkollen://`

## Klart när

- [ ] `appId` = `se.catchme.vindkollen` i capacitor.config.ts  
- [ ] Xcode PRODUCT_BUNDLE_IDENTIFIER = `se.catchme.vindkollen` (Debug + Release)  
- [ ] ios-verify.sh uppdaterad  
- [ ] Inga `se.vindkollen.app` kvar i native-config  
- [ ] Committat  
