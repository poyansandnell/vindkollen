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
 * Navigerar till /vindkraft-karta/ via intern routing i både webb och native.
 * Om VITE_PUBLIC_APP_URL är explicit satt öppnas URL:en externt i Safari/Chrome
 * via _system — annars används alltid intern navigation (inget krav på env-variabel).
 */
export function openSverigekartan(): void {
  const externalBase = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) ?? "";
  if (isNative() && externalBase) {
    window.open(`${externalBase}/vindkraft-karta/`, "_system");
  } else {
    window.location.href = "/vindkraft-karta/";
  }
}

// ---------------------------------------------------------------------------
// Behörigheter
// ---------------------------------------------------------------------------

/**
 * Begär kamerabehörighet via Capacitor-plugin på iOS/Android.
 *
 * På iOS visar detta systemdialogen "Vindkollen vill använda kameran"
 * INNAN getUserMedia anropas — utan detta steg nekar WKWebView tyst.
 *
 * På webb: returnerar alltid true (webbläsaren hanterar dialog via getUserMedia).
 *
 * @returns true om behörighet beviljades (eller om vi kör i webbläsare),
 *          false om användaren nekade.
 */
export async function requestNativeCameraPermission(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const { Camera } = await import("@capacitor/camera");
    const status = await Camera.requestPermissions({ permissions: ["camera"] });
    return status.camera === "granted";
  } catch {
    // Plugin-fel (t.ex. saknas i build) — låt getUserMedia försöka ändå
    return true;
  }
}

/**
 * Begär platsbehörighet via Capacitor-plugin på iOS/Android.
 *
 * På iOS visar detta systemdialogen "Vindkollen vill använda din plats"
 * INNAN navigator.geolocation.watchPosition anropas.
 *
 * @returns true om behörighet beviljades, false om nekad.
 */
export async function requestNativeGeolocationPermission(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const status = await Geolocation.requestPermissions();
    return status.location === "granted" || status.coarseLocation === "granted";
  } catch {
    return true;
  }
}
