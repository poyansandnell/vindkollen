# V42b – Replit Agent: ios-setup photo keys + pnpm core-js

**Två små hållbara fixar.** Inga AR/UI-ändringar.

## 1. `scripts/ios-setup.sh` – samma privacy keys som Info.plist

`pnpm native:plist` / `native:ios` måste skriva **alla** keys som App Store kräver (ITMS-90683), inte bara camera/location/mic/motion.

Lägg till i `artifacts/vindkraft-ar-katrineholm/scripts/ios-setup.sh`:

```bash
plist_set "NSLocationAlwaysAndWhenInUseUsageDescription" \
  "Vindkollen använder din position för att beräkna avstånd och riktning till vindkraftverken i AR och på kartan. Platsen används medan appen är öppen."

plist_set "NSPhotoLibraryUsageDescription" \
  "Vindkollen behöver tillgång till fotobiblioteket så att du kan spara och dela fotomontage av vindkraftverk i AR."

plist_set "NSPhotoLibraryAddUsageDescription" \
  "Vindkollen behöver spara fotomontage av vindkraftverk till ditt fotobibliotek."
```

Verifiera med `verify_key` för samma tre + uppdatera slutraden till  
`iOS privacy keys verified: camera, location, motion, microphone, photo`.

## 2. `pnpm-workspace.yaml` – macOS `pnpm install` failar

På Mac:

```
ERR_PNPM_IGNORED_BUILDS … core-js@3.49.0
ERROR Command failed with exit code 1: pnpm install
```

Orsak: `onlyBuiltDependencies` saknar `core-js`. Lägg till:

```yaml
onlyBuiltDependencies:
  - '@swc/core'
  - core-js
  - esbuild
  - msw
  - unrs-resolver
```

## Verifiering Mac

```bash
cd artifacts/vindkraft-ar-katrineholm
pnpm install   # ska inte längre exit 1 pga core-js
bash scripts/ios-setup.sh
# förväntat: 7 gröna inkl. photo library
```

## Commit

```
fix(ios): durable privacy keys in ios-setup + allow core-js builds

- ios-setup.sh writes photo + always-location strings (ITMS-90683)
- pnpm onlyBuiltDependencies includes core-js so Mac install works
```
