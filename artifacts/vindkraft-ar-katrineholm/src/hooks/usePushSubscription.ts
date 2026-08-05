/**
 * usePushSubscription
 *
 * Registrerar webbläsarens push-prenumeration mot API-servern.
 * Körs tyst i bakgrunden — push är en bonusfunktion och får aldrig krascha
 * huvudflödet om webbläsaren inte stöder det eller om servern är nere.
 *
 * Fungerar bara i PWA/webläsarläge. Capacitor/native-appar hanteras separat (FCM).
 */

import { useEffect, useRef } from "react";

const SUBSCRIBED_KEY = "vindkollen:pushSubscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function syncWithServer(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}

export function usePushSubscription(): void {
  const triedRef = useRef(false);

  useEffect(() => {
    // Bara köra en gång, och bara i webbläsare med stöd för service workers + Push API.
    if (triedRef.current) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    // Stöds inte i Capacitor-webview — hoppa över.
    if (window.location.protocol === "capacitor:") return;
    triedRef.current = true;

    void (async () => {
      try {
        // Hämta VAPID public key.
        const keyRes = await fetch("/api/push/vapid-public-key");
        if (!keyRes.ok) return; // Push inte konfigurerat på servern.
        const { publicKey } = (await keyRes.json()) as { publicKey: string };

        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();

        if (existing) {
          // Befintlig prenumeration — synka mot servern (endpoint kan ha ändrats efter en ny SW-install).
          await syncWithServer(existing);
          return;
        }

        // Ny prenumeration — vi behöver notis-tillstånd.
        // Be bara om tillstånd om användaren inte redan avvisat det.
        if (Notification.permission === "denied") return;

        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Casta bort den generiska TypeScript-parameteriseringen av Uint8Array
          // som kolliderar med den äldre BufferSource-signaturen i lib.dom.d.ts.
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as ArrayBuffer,
        });

        await syncWithServer(sub);
        localStorage.setItem(SUBSCRIBED_KEY, "1");
      } catch {
        // Tyst fel — push är valfritt.
      }
    })();
  }, []);
}
