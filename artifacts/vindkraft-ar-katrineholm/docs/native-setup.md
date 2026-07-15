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

## Klona och första setup

```bash
# Klona repot till din Mac
git clone <din-repo-url>
cd <repo>

# Installera alla beroenden
pnpm install

# Gå till workspace-mappen
cd artifacts/vindkraft-ar-katrineholm
```

---

## Lägg till native-plattformar (körs en gång)

```bash
# Lägg till iOS och Android (skapar ios/ och android/ mapparna)
pnpm exec cap add ios
pnpm exec cap add android
```

> **OBS:** `ios/` och `android/` är inte committade i repot — de skapas lokalt av dig.

---

## Bygg och synkronisera

Byt `<DIN-API-URL>` mot produktionsadressen:

```bash
# iOS
VITE_API_BASE_URL=https://<repl-name>--<owner>.repl.co pnpm native:ios

# Android
VITE_API_BASE_URL=https://<repl-name>--<owner>.repl.co pnpm native:android
```

Dessa kommandon gör i ordning:
1. `vite build --config vite.native.config.ts` → bygger till `dist-native/`
2. `cap sync ios` / `cap sync android` → kopierar webbfiler + plugins till native-projektet
3. `cap open ios` / `cap open android` → öppnar Xcode / Android Studio

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
