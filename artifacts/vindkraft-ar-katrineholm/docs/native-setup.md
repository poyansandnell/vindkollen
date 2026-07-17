# Native-byggning — iOS och Android (Capacitor)

Vindkollen är förberedd för iOS och Android via [Capacitor 8](https://capacitorjs.com/). Replit kan inte köra Xcode eller Android Studio, men alla konfigurationsfiler är klara. Bygg och publicera görs lokalt på din Mac.

---

## Workspace som paketeras

`artifacts/vindkraft-ar-katrineholm` — innehåller AR-vyn, Sverigekartan, projektanalysen och användarkontot i ett och samma flöde.

---

## Produktions-API-adress

API-servern körs på din Replit-deployment. Hitta den exakta domänen i Replit → Deployments. Den brukar se ut som:

```
https://<repl-name>--<owner>.repl.co
```

Sätt den som miljövariabel vid native-bygget (se "Bygg lokalt" nedan).

---

## Förutsättningar (lokalt på din Mac)

| Verktyg | Version |
|---------|---------|
| Node.js | 22 eller senare |
| pnpm | 10 eller senare (`npm i -g pnpm`) |
| Xcode | 16 eller senare (iOS) |
| Xcode Command Line Tools | `xcode-select --install` |
| CocoaPods | `sudo gem install cocoapods` |
| Android Studio | Flamingo eller senare |
| Java | 17+ (medföljer Android Studio) |

---

## Klona och öppna i Xcode (komplett från ren checkout)

`ios/` är **committad i repot** och innehåller alla nödvändiga projektfiler inkl. `Package.resolved` med pinnade SPM-versioner. Det betyder att du kan öppna projektet i Xcode direkt efter dessa steg utan att behöva göra Reset Package Caches, Resolve Package Versions eller lägga till filer manuellt:

```bash
# 1. Klona
git clone <din-repo-url>
cd <repo>

# 2. Installera npm-beroenden
pnpm install

# 3. Bygg webb-bundeln för Capacitor
pnpm --filter @workspace/vindkraft-ar-katrineholm run native:build

# 4. Synkronisera Capacitor (kopierar webb-filer + regenererar Package.swift)
npx cap sync ios --project-path artifacts/vindkraft-ar-katrineholm

# 5. Öppna i Xcode — fungerar direkt, inga manuella steg
open artifacts/vindkraft-ar-katrineholm/ios/App/App.xcodeproj
```

**Varför fungerar det?** `Package.resolved` är committad på:
`ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`

Den pekar ut exakta git-revisioner för alla fjärr-SPM-paket:
- `capacitor-swift-pm` 8.4.2
- `ion-ios-camera` 1.0.4  (→ `IONCameraLib`, används av `@capacitor/camera`)
- `ion-ios-geolocation` 2.1.1  (→ `IONGeolocationLib`, används av `@capacitor/geolocation`)

Xcode läser `Package.resolved` och hämtar dessa pinnade versioner i bakgrunden — utan dialog, utan manuella steg.

---

## Bygg för distribution (inkl. API-URL)

Byt `<DIN-API-URL>` mot produktionsadressen:

```bash
# iOS — bygger, synkroniserar, kör xcodebuild -resolvePackageDependencies, öppnar Xcode
VITE_API_BASE_URL=https://<repl-name>--<owner>.repl.co pnpm --filter @workspace/vindkraft-ar-katrineholm run native:ios

# Android
VITE_API_BASE_URL=https://<repl-name>--<owner>.repl.co pnpm --filter @workspace/vindkraft-ar-katrineholm run native:android
```

`native:ios` gör i ordning:
1. `vite build --config vite.native.config.ts` → bygger till `dist-native/`
2. `cap sync ios` → kopierar webbfiler + regenererar `CapApp-SPM/Package.swift`
3. `scripts/ios-setup.sh` → skriver in Info.plist privacy strings
4. `xcodebuild -resolvePackageDependencies` → löser SPM-paket och uppdaterar `Package.resolved`
5. `cap open ios` → öppnar Xcode

> **När du lägger till ett nytt Capacitor-plugin:** kör `pnpm native:ios` → `xcodebuild -resolvePackageDependencies` uppdaterar `Package.resolved` → committera den uppdaterade filen.

---

## iOS (Xcode)

1. Välj ditt **Apple Developer Team** under *Signing & Capabilities*
2. Välj en riktigt **fysisk iPhone** som target (inte simulator för AR)
3. Tryck ▶ eller `Cmd+R` för att bygga och köra
4. För App Store: *Product → Archive*, sedan ladda upp via Xcode Organizer

**Bundle ID:** `se.vindkollen.app`  
**Display Name:** Vindkollen  
**Version:** 1.0.0 · Build: 1

---

## Android (Android Studio)

1. Vänta på Gradle sync
2. Välj en fysisk Android-enhet som target
3. Tryck ▶ för att köra
4. För Play Store: *Build → Generate Signed Bundle* (`.aab`-format)

**Package name:** `se.vindkollen.app`  
**Version name:** 1.0.0 · Version code: 1

---

## Behörigheter

Capacitor begär behörigheter när respektive funktion används (inte vid uppstart):

| Funktion | Behörighet | Förklaring |
|----------|-----------|-----------|
| AR-vy | Kamera | Visa vindkraftverk i den verkliga omgivningen |
| AR-vy | Plats (GPS) | Placera verk korrekt i förhållande till din position |
| AR-vy | Rörelsesensor | Kompass och enhetsorientering för AR-riktning |
| Karta | — | Fungerar utan behörigheter |

---

## Känd begränsning i WKWebView (iOS)

| API | Status |
|-----|--------|
| `getUserMedia` (kamera) | ✅ Fungerar i Capacitor WKWebView |
| `navigator.geolocation` | ✅ Fungerar |
| `DeviceOrientationEvent` | ✅ Fungerar — Capacitor hanterar `requestPermission()` |
| `DeviceMotionEvent` | ✅ Fungerar |
| `localStorage` | ✅ Fungerar |
| Service Workers (PWA) | ⚠️ Begränsad i WKWebView — native-bygget använder ingen SW |
| WebXR | ❌ Inte tillgänglig — appen använder ej WebXR (Three.js + sensordata istället) |

**Testa på fysisk enhet innan App Store-submit** — kamera och kompass fungerar inte i simulator.

---

## Fullständig testchecklista (fysisk telefon)

- [ ] Karta öppnas utan behörigheter
- [ ] Skapa ny placering → poängberäkning
- [ ] AR-vy: kamera startar → kompass kalibrering → verk syns på rätt riktning
- [ ] Avståndslabel och buller-dBA uppdateras
- [ ] Spara placering (inloggad → molnet, anonym → lokalt)
- [ ] Mina projekt: lista, redigera, dela länk
- [ ] Logga in → logga ut
- [ ] Stäng appen → öppna igen → session bevaras
- [ ] AR → bakgrundsläge → tillbaka → sensorer återupptas
- [ ] Android bakåtknapp navigerar korrekt
- [ ] Safe area kring kameraö och hemindikator (iPhone)
- [ ] Delningslänk fungerar (kopieras till clipboard)

---

## Filer att konfigurera inför App Store / Play Store

- `ios/App/App/Info.plist` — skriv in permission descriptions på svenska
- `android/app/src/main/AndroidManifest.xml` — verifiera permissions
- Appikon: ersätt platshållare med riktig 1024×1024 px ikon
- Splash screen: konfigurera i `capacitor.config.ts` under `plugins.SplashScreen`
