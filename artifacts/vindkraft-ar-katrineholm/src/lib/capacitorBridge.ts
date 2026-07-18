/**
 * Capacitor-brygga — centraliserat ställe för allt som skiljer sig
 * mellan native (iOS/Android) och webb.
 *
 * Importera BARA från denna fil när du behöver skilja på plattformar.
 * Undvik att sprida `Capacitor.isNativePlatform()` och plugin-importer
 * direkt i hook- eller komponent-filer.
 */
import { Capacitor } from "@capacitor/core";

/** True om appen körs i Capacitor (iOS eller Android). */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Öppnar Sverigekartan.
 *
 * - Webb: navigerar direkt till /vindkraft-karta/ (path routing).
 * - Native: öppnar vindkollen.com/vindkraft-karta/ i ett in-app
 *   SFSafariViewController-ark via @capacitor/browser — samma UX som
 *   webben, men utan att lämna appen. Användaren stänger arket med
 *   "Klar"-knappen och befinner sig kvar i Vindkollen.
 *   När vindkollen.com implementerar deep-links (vindkollen://placera?
 *   projectId=...) kan användaren dessutom trycka "Redigera" på ett
 *   projekt i webbvyn och hoppa direkt in i AR-vyn med rätt projekt.
 */
export async function openSverigekartan(): Promise<void> {
  if (isNative()) {
    const url = "https://vindkollen.com/vindkraft-karta/";
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
    } catch (err) {
      // Browser-plugin saknas eller misslyckas → fallback till hash-navigering
      // med det inbyggda PlaceTurbines-kartverktyget (ESRI World Imagery).
      console.warn("[Vindkollen] Browser.open misslyckades, faller tillbaka till /placera:", err);
      void stopNativeCameraPreview();
      // V13: sätt FOKUS-flagga också, så NationalMapView auto-fokuserar på närmaste projekt
      sessionStorage.setItem("vindkollen:sverigekartanFocusNearest", "1");
      sessionStorage.setItem("vindkollen:placeraFresh", "1");
      window.location.hash = "/placera";
    }
  } else {
    window.location.href = "/vindkraft-karta/";
  }
}

/**
 * Konsumerar flaggan som `openSverigekartan()` sätter när den navigerar till
 * `/placera` från hemvyn på native. Returnerar `true` en gång (vid den första
 * mount av PlaceTurbines efter navigeringen) och tar bort flaggan.
 */
export function consumeFreshPlaceraFlag(): boolean {
  const val = sessionStorage.getItem("vindkollen:placeraFresh") === "1";
  if (val) sessionStorage.removeItem("vindkollen:placeraFresh");
  return val;
}

/**
 * Konsumerar flaggan som `openPlaceraEditor()` sätter för att hoppa direkt
 * till editor-läget (utan att visa den nationella välkomst-/projektväljar-
 * kartan). Returnerar `true` en gång och tar bort flaggan.
 */
export function consumeDirectEditorFlag(): boolean {
  const val = sessionStorage.getItem("vindkollen:placeraEditorDirect") === "1";
  if (val) sessionStorage.removeItem("vindkollen:placeraEditorDirect");
  return val;
}

/**
 * Öppnar PlaceTurbines-editorn direkt (utan att visa den nationella
 * projektväljarkartan). Används av "Visa karta" i AR-vyn.
 *
 * - Sätter sessionStorage-flaggan `vindkollen:placeraEditorDirect`.
 * - Stoppar native kamerapreview (synkront) innan hash-navigeringen.
 * - På webb: sätter hash direkt (PlaceTurbines monteras alltid färsk).
 */
export function openPlaceraEditor(): void {
  if (isNative()) {
    void stopNativeCameraPreview();
  }
  sessionStorage.setItem("vindkollen:placeraEditorDirect", "1");
  window.location.hash = "/placera";
}

/**
 * Öppnar den NATIVE PlaceTurbines-vyn (med MapLibre-karta och V5-fokus-flagga)
 * istället för att öppna SFSafariViewController mot webbsidan.
 *
 * - Sätter båda flaggorna: focusNearest (för 📍-badge) och placeraFresh (för mount).
 * - Stoppar native kamerapreview om vi är i native.
 * - Navigerar till /placera.
 */
export async function openPlaceraWithFocus(): Promise<void> {
  sessionStorage.setItem("vindkollen:sverigekartanFocusNearest", "1");
  sessionStorage.setItem("vindkollen:placeraFresh", "1");
  if (isNative()) {
    void stopNativeCameraPreview();
  }
  window.location.hash = "/placera";
}

// ---------------------------------------------------------------------------
// Kamera — native camera preview (CameraPreview plugin)
// ---------------------------------------------------------------------------

let _cameraPreviewActive = false;

// ---------------------------------------------------------------------------
// Sequential permission state — prevents parallel iOS dialog freeze
// ---------------------------------------------------------------------------

let _isRequestingPermissions = false;
let _nativePermissionsGranted = false;

/** True after requestAllPermissionsSequentially() succeeded. Hooks use this to skip re-requesting. */
export function areNativePermissionsGranted(): boolean {
  return _nativePermissionsGranted;
}

/**
 * Startar native camera-preview (renderas som ett nativt lager BAKOM WKWebView).
 * Body-bakgrunden görs genomskinlig så Three.js-canvasen syns ovanpå.
 * No-op på webb.
 */
export async function startNativeCameraPreview(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { CameraPreview } = await import("@capacitor-community/camera-preview");
    await CameraPreview.start({
      position: "rear",
      toBack: true,
      width: window.screen.width,
      height: window.screen.height,
      x: 0,
      y: 0,
      enableZoom: false,
    });
    _cameraPreviewActive = true;
    // Gör hela DOM-stacken transparent så att native CameraPreview-lagret syns.
    document.body.style.backgroundColor = "transparent";
    document.documentElement.style.backgroundColor = "transparent";
    const root = document.getElementById("root");
    if (root) root.style.background = "transparent";
    console.log("[Vindkollen] CameraPreview started");
    return true;
  } catch (err) {
    console.error("[Vindkollen] CameraPreview.start failed:", err);
    _cameraPreviewActive = false;
    addNativeError(`CameraPreview.start: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Stoppar native camera-preview och återställer bakgrundsfärg. */
export async function stopNativeCameraPreview(): Promise<void> {
  if (!_cameraPreviewActive) return;
  _cameraPreviewActive = false;
  document.body.style.backgroundColor = "";
  document.documentElement.style.backgroundColor = "";
  const root = document.getElementById("root");
  if (root) root.style.background = "";
  if (!isNative()) return;
  try {
    const { CameraPreview } = await import("@capacitor-community/camera-preview");
    await CameraPreview.stop();
    console.log("[Vindkollen] CameraPreview stopped");
  } catch (err) {
    console.error("[Vindkollen] CameraPreview.stop failed:", err);
  }
}

/**
 * Fångar en bildruta från native camera-preview som en data-URL.
 * Returnerar null om preview inte är aktiv eller om fångst misslyckas.
 */
export async function captureNativeCameraPhoto(): Promise<string | null> {
  if (!isNative() || !_cameraPreviewActive) return null;
  try {
    const { CameraPreview } = await import("@capacitor-community/camera-preview");
    const result = await CameraPreview.capture({ quality: 90 });
    return `data:image/jpeg;base64,${result.value}`;
  } catch (err) {
    console.error("[Vindkollen] CameraPreview.capture failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Behörigheter
// ---------------------------------------------------------------------------

/**
 * Begär kamerabehörighet via Capacitor-plugin på iOS/Android.
 * Loggar alla utfall — kastar INTE fel tyst.
 * Returnerar false om nekad, true om beviljad eller om vi kör i webbläsare.
 */
export async function requestNativeCameraPermission(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const { Camera } = await import("@capacitor/camera");
    const current = await Camera.checkPermissions();
    console.log("[Vindkollen] Camera.checkPermissions →", current.camera);
    if (current.camera === "granted") return true;
    const requested = await Camera.requestPermissions({ permissions: ["camera"] });
    console.log("[Vindkollen] Camera.requestPermissions →", requested.camera);
    const granted = requested.camera === "granted";
    if (!granted) addNativeError(`Kamerabehörighet nekad (status: ${requested.camera})`);
    return granted;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Vindkollen] Camera.requestPermissions failed:", msg);
    addNativeError(`Camera.requestPermissions: ${msg}`);
    return false;
  }
}

/**
 * Begär platsbehörighet via Capacitor-plugin på iOS/Android.
 * checkPermissions() → requestPermissions() för att trigga iOS-dialog.
 */
export async function requestNativeGeolocationPermission(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const current = await Geolocation.checkPermissions();
    console.log("[Vindkollen] Geolocation.checkPermissions →", current.location);
    if (current.location === "granted") return true;
    const requested = await Geolocation.requestPermissions();
    console.log("[Vindkollen] Geolocation.requestPermissions →", requested.location);
    const granted = requested.location === "granted" || requested.coarseLocation === "granted";
    if (!granted) addNativeError(`Platsbehörighet nekad (status: ${requested.location})`);
    return granted;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Vindkollen] Geolocation.requestPermissions failed:", msg);
    addNativeError(`Geolocation.requestPermissions: ${msg}`);
    return false;
  }
}

/**
 * Begär kamera- och platsbehörighet SEKVENTIELLT med en guard mot parallella
 * anrop. Returnerar resultatet och sätter _nativePermissionsGranted så att
 * useCameraStream/useGeolocation kan hoppa över att begära behörighet igen.
 *
 * Anropa detta från handleStart i Home.tsx på native INNAN setStarted(true).
 * Starta ALDRIG CameraPreview eller watchPosition medan denna funktion körs.
 */
export async function requestAllPermissionsSequentially(): Promise<{
  camera: boolean;
  location: boolean;
  error?: string;
}> {
  if (_isRequestingPermissions) {
    console.warn("[Vindkollen] requestAllPermissionsSequentially: pågår redan, ignorerar");
    return { camera: false, location: false, error: "Behörighetsförfrågan pågår redan" };
  }
  _isRequestingPermissions = true;
  _nativePermissionsGranted = false;

  try {
    // Steg 1/2 — Kamera
    console.log("[AR] Requesting camera permission");
    let cameraGranted = false;
    try {
      cameraGranted = await requestNativeCameraPermission();
    } catch (camErr) {
      console.error("[AR] Camera permission threw:", camErr);
      return { camera: false, location: false, error: `Kamerabehörighet kastade fel: ${camErr instanceof Error ? camErr.message : String(camErr)}` };
    }
    console.log("[AR] Camera permission result:", cameraGranted ? "granted" : "denied");

    if (!cameraGranted) {
      return {
        camera: false,
        location: false,
        error: "Kamerabehörighet nekad. Aktivera i Inställningar → Vindkollen → Kamera.",
      };
    }

    // Ge iOS tid att stänga den första dialogen helt innan nästa visas
    console.log("[AR] Waiting 350 ms between permission dialogs");
    await new Promise<void>((r) => setTimeout(r, 350));

    // Steg 2/2 — Plats
    console.log("[AR] Requesting location permission");
    let locationGranted = false;
    try {
      locationGranted = await requestNativeGeolocationPermission();
    } catch (locErr) {
      console.error("[AR] Location permission threw:", locErr);
      return { camera: true, location: false, error: `Platsbehörighet kastade fel: ${locErr instanceof Error ? locErr.message : String(locErr)}` };
    }
    console.log("[AR] Location permission result:", locationGranted ? "granted" : "denied");

    if (!locationGranted) {
      return {
        camera: true,
        location: false,
        error: "Platsbehörighet nekad. Aktivera i Inställningar → Vindkollen → Plats.",
      };
    }

    _nativePermissionsGranted = true;
    console.log("[AR] All permissions granted ✓");
    return { camera: true, location: true };
  } finally {
    _isRequestingPermissions = false;
  }
}

// ---------------------------------------------------------------------------
// Native GPS watchPosition (mer tillförlitlig än navigator.geolocation i WKWebView)
// ---------------------------------------------------------------------------

export type NativePosCallback = (lat: number, lon: number, accuracy: number) => void;
export type NativeErrCallback = (message: string) => void;

/**
 * Bevakar GPS-positionen via @capacitor/geolocation istället för browser-API:et.
 * På webb returnerar en no-op cleanup-funktion och gör ingenting.
 * @returns async cleanup-funktion — anropa för att stoppa bevakningen.
 */
export async function watchNativePosition(
  onPos: NativePosCallback,
  onErr: NativeErrCallback,
): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 15000 },
      (position, err) => {
        if (err) {
          const msg = (err as Error).message ?? "GPS-fel.";
          console.error("[Vindkollen] Geolocation.watchPosition error:", err);
          addNativeError(`GPS watchPosition: ${msg}`);
          onErr(msg);
        } else if (position) {
          onPos(
            position.coords.latitude,
            position.coords.longitude,
            position.coords.accuracy,
          );
        }
      },
    );
    console.log("[Vindkollen] Geolocation.watchPosition started, watchId:", watchId);
    return async () => {
      try {
        await Geolocation.clearWatch({ id: watchId });
        console.log("[Vindkollen] Geolocation.clearWatch:", watchId);
      } catch {}
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Vindkollen] Geolocation.watchPosition setup failed:", msg);
    addNativeError(`Geolocation setup: ${msg}`);
    onErr(msg);
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// Skärmorientering — låser/låser upp porträttläge under kompasskalibrering
// ---------------------------------------------------------------------------

/**
 * Försöker låsa skärmen i porträttläge (portrait-primary).
 *
 * Använder Screen Orientation Web API (`screen.orientation.lock()`):
 * - Fungerar i Android Chrome / Android PWA och i de flesta moderata
 *   webbläsare som stöder standarden.
 * - iOS Safari stödjer INTE `screen.orientation.lock()` — kastar ett
 *   `NotSupportedError` som vi fångar tyst.  På ett framtida build kan
 *   detta ersättas med `@capacitor/screen-orientation`-plugin.
 *
 * Anropas från Home.tsx när kompasskalibreringsbannern visas, för att
 * förhindra att en landskapsrotation avbryter kalibreringsrörelsen.
 */
export function lockPortraitOrientation(): void {
  try {
    // screen.orientation.lock is a W3C Screen Orientation API — present in
    // Android Chrome and some PWA contexts but NOT in iOS Safari (throws
    // NotSupportedError). Cast to `unknown` to avoid the TS lib mismatch.
    const so = typeof screen !== "undefined" ? (screen.orientation as unknown as Record<string, unknown>) : null;
    if (so && typeof so["lock"] === "function") {
      void (so["lock"] as (o: string) => Promise<void>)("portrait-primary").catch(() => {
        // Kastas normalt på iOS Safari och i webbläsare som inte stöder låsning.
      });
    }
  } catch {
    // Ignorera — orientationslåsning är alltid best-effort.
  }
}

/**
 * Låser upp skärmorientering om den var låst av `lockPortraitOrientation()`.
 * No-op om skärmen inte stöder orientationslåsning.
 */
export function unlockOrientation(): void {
  try {
    const so = typeof screen !== "undefined" ? (screen.orientation as unknown as Record<string, unknown>) : null;
    if (so && typeof so["unlock"] === "function") {
      (so["unlock"] as () => void)();
    }
  } catch {
    // Ignorera.
  }
}

// ---------------------------------------------------------------------------
// Diagnostik (synlig i NativeDiagnostics-panelen på enheten)
// ---------------------------------------------------------------------------

const _nativeErrors: string[] = [];

function addNativeError(msg: string) {
  _nativeErrors.unshift(`${new Date().toISOString().slice(11, 23)} ${msg}`);
  if (_nativeErrors.length > 5) _nativeErrors.length = 5;
}

export interface NativeDiagnosticsData {
  platform: string;
  isNative: boolean;
  cameraPermission: string;
  locationPermission: string;
  cameraPreviewActive: boolean;
  errors: string[];
}

export async function getNativeDiagnostics(): Promise<NativeDiagnosticsData> {
  const platform = Capacitor.getPlatform();
  const native = Capacitor.isNativePlatform();
  let cameraPermission = "n/a (webb)";
  let locationPermission = "n/a (webb)";

  if (native) {
    try {
      const { Camera } = await import("@capacitor/camera");
      const cs = await Camera.checkPermissions();
      cameraPermission = cs.camera;
    } catch (e) {
      cameraPermission = `fel: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const gs = await Geolocation.checkPermissions();
      locationPermission = gs.location;
    } catch (e) {
      locationPermission = `fel: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return {
    platform,
    isNative: native,
    cameraPermission,
    locationPermission,
    cameraPreviewActive: _cameraPreviewActive,
    errors: [..._nativeErrors],
  };
}
