# Native-byggning — iOS (Capacitor)

Vindkollen är förberedd för iOS via [Capacitor 8](https://capacitorjs.com/). Replit kan inte köra Xcode, men alla konfigurationsfiler är klara. Bygg och publicera görs lokalt på din Mac.

---

## Förutsättningar (lokalt på din Mac)

| Verktyg | Version |
|---------|---------|
| Node.js | 22 eller senare |
| pnpm | 10 eller senare (`npm i -g pnpm`) |
| Xcode | 16 eller senare |
| Xcode Command Line Tools | `xcode-select --install` |

> **CocoaPods krävs ej.** Projektet använder Swift Package Manager (SPM), inte CocoaPods.

---

## Klona och öppna i Xcode (komplett från ren checkout)

`ios/` är **committad i repot** och innehåller alla nödvändiga projektfiler inkl. `Package.resolved` med pinnade SPM-versioner och **committade SPM-symlinks** (se nedan). Använd alltid `pnpm native:ios` — kör aldrig `npx cap sync ios` direkt från monorepo-roten eller manuellt utan att sedan köra fix-skriptet:

```bash
# 1. Klona
git clone <din-repo-url>
cd <repo>

# 2. Installera npm-beroenden (skapar pnpm virtual store + artifact-lokala node_modules)
pnpm install

# 3. Bygg, synka, fixa SPM-sökvägar och öppna Xcode (ett enda kommando)
pnpm --filter @workspace/vindkraft-ar-katrineholm run native:ios
```

> Öppna **inte** Xcode manuellt direkt efter `git clone + pnpm install`. `native:ios` måste köras minst en gång för att `CapApp-SPM/symlinks/` ska skapas/uppdateras och `xcodebuild -resolvePackageDependencies` ska hämta SPM-paketen.

---

## Hur SPM-beroenden löses automatiskt

`project.pbxproj` matchar den **officiella Capacitor 8.x SPM-template** och refererar enbart till det lokala `CapApp-SPM`-paketet:

```
ios/App/CapApp-SPM/Package.swift   ← hanteras av "cap sync ios" + fix-skript
```

### Symlink-lösning (kritisk för Xcode 15/16)

Xcode misslyckas ibland att lösa pnpm virtual store-sökvägar med `+`/`@` i katalognamnen (t.ex. `node_modules/.pnpm/@capacitor+camera@8.2.1_@capacitor+core@8.4.2/...`). Projektet använder därför committade **relativa symlinks** med rena namn:

```
ios/App/CapApp-SPM/symlinks/
  CapacitorCamera              → ../../../../node_modules/@capacitor/camera
  CapacitorGeolocation         → ../../../../node_modules/@capacitor/geolocation
  CapacitorCommunityCameraPreview → ../../../../node_modules/@capacitor-community/camera-preview
```

Symlinkar pekar på pnpm:s **artifact-lokala node_modules** (med rena namn, inte virtual store-sökvägar). Dessa symlinks är committade med relativa sökvägar — de fungerar på alla maskiner efter `pnpm install`.

`CapApp-SPM/Package.swift` refererar till `symlinks/CapacitorCamera` etc. (rena korta sökvägar), och `cap sync ios` körs alltid följt av `scripts/fix-ios-package-swift.js` (via `native:fix-spm`) som återskapar symlinks och rättar Package.swift om `cap sync` skriver över den.

`CapApp-SPM/Package.swift` refererar i sin tur till:
- `capacitor-swift-pm` (fjärr-GitHub, pinnad)
- `symlinks/CapacitorCamera`, `symlinks/CapacitorGeolocation`, `symlinks/CapacitorCommunityCameraPreview` (via relativa symlinks)

`Package.resolved` är committad på:
`ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`

Den pekar ut exakta git-revisioner för alla fjärr-SPM-paket:
- `capacitor-swift-pm` 8.4.2
- `ion-ios-camera` 1.0.4  (→ `IONCameraLib`, används av `@capacitor/camera`)
- `ion-ios-geolocation` 2.1.1  (→ `IONGeolocationLib`, används av `@capacitor/geolocation`)

Xcode läser `Package.resolved` och hämtar dessa pinnade versioner i bakgrunden — utan dialog, utan manuella steg.

### Varför `import Capacitor` fungerar utan direkt referens

I Xcodes SPM-integration exponeras alla moduler i det upplösta beroende-trädet för parent-target. Appens target länkar `CapApp-SPM`, som i sin tur beror på `Capacitor` — det räcker för att `import Capacitor` i `AppDelegate.swift` ska fungera. (Detta är ett Xcode-specifikt beteende, inte strikt Swift Package Manager på kommandoraden.)

---

## Bygg för distribution (inkl. API-URL)

Byt `<DIN-API-URL>` mot produktionsadressen från Replit → Deployments:

```bash
VITE_API_BASE_URL=https://<repl-name>--<owner>.repl.co \
  pnpm --filter @workspace/vindkraft-ar-katrineholm run native:ios
```

`native:ios` gör i ordning:
1. `vite build --config vite.native.config.ts` → bygger till `dist-native/`
2. `cap sync ios` → kopierar webbfiler + regenererar `CapApp-SPM/Package.swift`
3. `scripts/fix-ios-package-swift.js` → återskapar symlinks + rättar Package.swift till rena sökvägar
4. `scripts/ios-setup.sh` → skriver in Info.plist privacy strings
5. `xcodebuild -resolvePackageDependencies` → löser SPM-paket och uppdaterar `Package.resolved`
6. `cap open ios` → öppnar Xcode

> **OBS:** `cap sync ios` och `cap open ios` måste köras från `artifacts/vindkraft-ar-katrineholm/`-katalogen — pnpm-skriptet hanterar detta automatiskt. Kör aldrig `npx cap sync ios` från monorepo-roten.

> **När du lägger till ett nytt Capacitor-plugin:** kör `pnpm native:ios` → `xcodebuild -resolvePackageDependencies` uppdaterar `Package.resolved` → committera den uppdaterade filen.

---

## Xcode — steg för att bygga och köra

1. Välj ditt **Apple Developer Team** under *Signing & Capabilities*
2. Välj en riktigt **fysisk iPhone** som target (inte simulator för AR/kamera)
3. Tryck ▶ eller `Cmd+R` för att bygga och köra
4. För App Store: *Product → Archive*, sedan ladda upp via Xcode Organizer

**Bundle ID:** `se.catchme.vindkollen`  
**Display Name:** Vindkollen  
**Version:** 1.0.0 · Build: 1

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

## Felsökning

**`import Capacitor` — No such module**  
→ Trolig orsak: `pnpm install` har inte körts, eller `cap sync ios` kördes från fel katalog.  
→ Åtgärd: Kör `pnpm install` från monorepo-roten, sedan `pnpm --filter @workspace/vindkraft-ar-katrineholm run native:ios`.  
→ Rensa DerivedData i Xcode: *Product → Clean Build Folder* (⇧⌘K), stäng och öppna projektet igen.

**`project.pbxproj` har ändrats av Xcode**  
→ Återställ: `git checkout -- ios/App/App.xcodeproj/project.pbxproj`  
→ Kör sedan `pnpm --filter @workspace/vindkraft-ar-katrineholm run native:ios`

**SPM-paket löses inte (nätverksfel)**  
→ Xcode → *File → Packages → Reset Package Caches*  
→ Xcode → *File → Packages → Resolve Package Versions*

---

## Fullständig testchecklista (fysisk telefon)

- [ ] Karta öppnas utan behörigheter
- [ ] AR-vy: kamera startar → kompass kalibrering → verk syns på rätt riktning
- [ ] Avståndslabel och buller-dBA uppdateras
- [ ] Skapa ny placering → poängberäkning
- [ ] AR → bakgrundsläge → tillbaka → sensorer återupptas
- [ ] Safe area kring kameraö och hemindikator (iPhone)

---

## Filer att konfigurera inför App Store

- `ios/App/App/Info.plist` — skriv in permission descriptions på svenska
- Appikon: ersätt platshållare med riktig 1024×1024 px ikon
- Splash screen: konfigurera i `capacitor.config.ts` under `plugins.SplashScreen`
