# V42 – Replit Agent: Info.plist privacy keys (ITMS-90683)

**Endast iOS Info.plist.** Inga AR-ändringar, inga UI-ändringar, ingen bundle-id-byte.

## Bakgrund

App Store Connect avvisade **Vindkollen 1.0 (build 2)** med:

1. **ITMS-90683 (blocker):** saknas `NSPhotoLibraryUsageDescription`  
2. **ITMS-90683 (warning):** saknas `NSLocationAlwaysAndWhenInUseUsageDescription`

Capacitor / camera / share-stack refererar fotobibliotek (fotomontage). Utan purpose-string i Info.plist får binären aldrig komma in i TestFlight.

Kamera, Location When In Use, Microphone och Motion finns redan – **rör dem inte**.

Kodbas: `artifacts/vindkraft-ar-katrineholm/`

---

## Mål

I `ios/App/App/Info.plist` – lägg till tre keys (om de saknas):

| Key | Value (svenska) |
|-----|-----------------|
| `NSPhotoLibraryUsageDescription` | `Vindkollen behöver tillgång till fotobiblioteket så att du kan spara och dela fotomontage av vindkraftverk i AR.` |
| `NSPhotoLibraryAddUsageDescription` | `Vindkollen behöver spara fotomontage av vindkraftverk till ditt fotobibliotek.` |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | `Vindkollen använder din position för att beräkna avstånd och riktning till vindkraftverken i AR och på kartan. Platsen används medan appen är öppen.` |

`NSPhotoLibraryAddUsageDescription` är bra att ha samtidigt (spar till rullning) även om Apple bara nämnde Usage i mailet.

---

## Exakt ändring

Fil: `artifacts/vindkraft-ar-katrineholm/ios/App/App/Info.plist`

Efter befintliga:

```xml
    <key>NSCameraUsageDescription</key>
    <string>Vindkollen behöver använda kameran för att visa vindkraftverken i AR.</string>
    <key>NSLocationWhenInUseUsageDescription</key>
    <string>Vindkollen behöver din position för att beräkna avstånd och riktning till vindkraftverken.</string>
    <key>NSMicrophoneUsageDescription</key>
    …
    <key>NSMotionUsageDescription</key>
    …
```

ska det se ut ungefär så här (ordningsföljd spelar mindre roll, nycklarna måste finnas):

```xml
    <key>NSCameraUsageDescription</key>
    <string>Vindkollen behöver använda kameran för att visa vindkraftverken i AR.</string>
    <key>NSLocationWhenInUseUsageDescription</key>
    <string>Vindkollen behöver din position för att beräkna avstånd och riktning till vindkraftverken.</string>
    <key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
    <string>Vindkollen använder din position för att beräkna avstånd och riktning till vindkraftverken i AR och på kartan. Platsen används medan appen är öppen.</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>Vindkollen behöver mikrofonbehörighet för kamerafunktionen i AR-läget.</string>
    <key>NSMotionUsageDescription</key>
    <string>Vindkollen behöver använda rörelsesensorer och kompass för att visa rätt riktning i AR.</string>
    <key>NSPhotoLibraryUsageDescription</key>
    <string>Vindkollen behöver tillgång till fotobiblioteket så att du kan spara och dela fotomontage av vindkraftverk i AR.</string>
    <key>NSPhotoLibraryAddUsageDescription</key>
    <string>Vindkollen behöver spara fotomontage av vindkraftverk till ditt fotobibliotek.</string>
```

### Om projektet bygger Info från Xcode “Info”-tab

Lägg samma tre rader som Privacy-nycklar där också, så de inte scryptas bort vid `npx cap sync` / `cap copy`:

| Xcode-namn | Key |
|------------|-----|
| Privacy - Photo Library Usage Description | `NSPhotoLibraryUsageDescription` |
| Privacy - Photo Library Additions Usage Description | `NSPhotoLibraryAddUsageDescription` |
| Privacy - Location Always and When In Use Usage Description | `NSLocationAlwaysAndWhenInUseUsageDescription` |

---

## Gör INTE

- Byt inte Bundle ID (det är V41 / redan `se.catchme.vindkollen`).
- Ta inte bort kamera/plats/mikrofon/motion-strings.
- Ändra inte URL-schemat `vindkollen://`.
- Rör inte `Home.tsx`, `ARScene.tsx` eller web-JS.
- Lägg inte till bakgrundsläge Location (UIBackgroundModes) – vi vill bara purpose-string.

---

## Verifiering

```bash
# Alla tre måste finnas:
rg "NSPhotoLibraryUsageDescription|NSPhotoLibraryAddUsageDescription|NSLocationAlwaysAndWhenInUseUsageDescription" \
  artifacts/vindkraft-ar-katrineholm/ios/App/App/Info.plist
```

Förväntat: tre träffar (tre keys).

---

## Efter merge (människa i Xcode)

1. Pull senaste main
2. Öppna `ios/App/App.xcworkspace` (eller `.xcodeproj`)
3. **General → Build** höj till nästa lediga (t.ex. **3** om 2 avvisades)
4. **Product → Archive → Distribute App → Upload**
5. TestFlight → build ska dyka upp (ITMS-90683 borta)

---

## Commit-meddelande (förslag)

```
fix(ios): add photo + always-location usage strings (ITMS-90683)

App Store rejected 1.0 (2) for missing NSPhotoLibraryUsageDescription.
Also add NSPhotoLibraryAddUsageDescription and
NSLocationAlwaysAndWhenInUseUsageDescription for Capacitor camera/share/location.
```

---

## Checklista

- [ ] Tre privacy keys i `ios/App/App/Info.plist`
- [ ] Befintliga Camera / Location When In Use / Mic / Motion orörda
- [ ] Inga andra filer ändrade
- [ ] Commit + push till main (så Xcode-clone alltid har strings)
