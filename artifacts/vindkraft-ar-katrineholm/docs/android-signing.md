# Android Release Signing — Vindkollen

Google Play använder **App Signing** — du laddar upp med en *upload key*, och Google signerar den faktiska release-APK:n med sin egen nyckel. Om du förlorar din upload key kan du byta den via Google Play Console.

## Steg 1 — Skapa en upload keystore (kör en gång på Mac)

```bash
keytool -genkeypair \
  -v \
  -storetype PKCS12 \
  -keystore ~/nycklar/vindkollen-upload.jks \
  -alias vindkollen \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Keytool frågar efter ett lösenord för keystoren och ett separat lösenord för nyckeln.
Spara båda lösenorden säkert (t.ex. i ett lösenordshanterare).

**Förvara `vindkollen-upload.jks` utanför repot** — t.ex. i `~/nycklar/` eller på ett USB-minne.

## Steg 2 — Konfigurera signering i projektet

Kopiera `android/keystore.properties.example` till `android/keystore.properties` (gitignorerad):

```bash
cp artifacts/vindkraft-ar-katrineholm/android/keystore.properties.example \
   artifacts/vindkraft-ar-katrineholm/android/keystore.properties
```

Öppna `keystore.properties` och fyll i:

```properties
storeFile=/Users/dittnamn/nycklar/vindkollen-upload.jks
storePassword=ditt-lösenord
keyAlias=vindkollen
keyPassword=ditt-nyckellösenord
```

`keystore.properties` är listad i `.gitignore` — filen committas aldrig.

## Steg 3 — Bygg .aab

```bash
cd artifacts/vindkraft-ar-katrineholm
pnpm android:prepare    # bygger dist-native och synkar
pnpm android:bundle     # skapar app-release.aab
```

Färdig fil: `android/app/build/outputs/bundle/release/app-release.aab`

## Steg 4 — Ladda upp till Google Play

1. Gå till [Google Play Console](https://play.google.com/console)
2. Välj **Vindkollen** → **Release** → **Production**
3. Klicka **Create new release**
4. Ladda upp `app-release.aab`
5. Google Play signerar automatiskt med sin nyckel (App Signing)

## CI/CD (alternativ till keystore.properties)

Sätt miljövariabler istället:

```bash
export VINDKOLLEN_STORE_FILE=/sökväg/till/vindkollen-upload.jks
export VINDKOLLEN_STORE_PASSWORD=lösenord
export VINDKOLLEN_KEY_ALIAS=vindkollen
export VINDKOLLEN_KEY_PASSWORD=lösenord
pnpm android:bundle
```

## Säkerhetschecklista

- [ ] `*.jks` och `keystore.properties` finns i `.gitignore`
- [ ] Upload keystore sparad utanför repot
- [ ] Lösenord lagrade i lösenordshanterare
- [ ] Google Play App Signing aktiverat i Play Console
- [ ] Release-builden har `debuggable=false` (kontrolleras av android:verify)
