import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

/**
 * Manuell service worker-registrering (istället för det auto-injicerade
 * skriptet — se `injectRegister: false` i vite.config.ts).
 *
 * Vi vill INTE att en ny version tar över och laddar om sidan automatiskt
 * (det var buggen som fick appen att "starta om sig själv" mitt i en
 * pågående AR-session, se registerType: "prompt"). Men om vi aldrig
 * hanterar `onNeedRefresh` alls hamnar vi i motsatt problem: den nya
 * service workern blir stående och väntar för evigt, och användaren
 * fortsätter köra en gammal, cachad version av appen tills alla flikar
 * stängts helt — vilket är precis varför tidigare fixar (t.ex.
 * GPS-vakthunden) inte verkade nå fram trots att de var publicerade.
 *
 * Lösningen: registrera som vanligt, men visa en liten, ickeblockerande
 * banner ("Ny version tillgänglig") som låter ANVÄNDAREN själv välja när
 * uppdateringen ska appliceras — aldrig automatiskt mitt i en session.
 */
let needRefreshListeners: Array<(v: boolean) => void> = [];
let needRefresh = false;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    needRefresh = true;
    needRefreshListeners.forEach((l) => l(true));
  },
  onOfflineReady() {},
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    // Kontrollera regelbundet om det finns en nyare version, så att
    // "Ny version tillgänglig"-bannern kan dyka upp även om användaren
    // aldrig stänger/öppnar fliken på nytt.
    window.setInterval(
      () => {
        void registration.update();
      },
      60 * 60 * 1000,
    );
  },
});

export function usePwaUpdate() {
  const [state, setState] = useState(needRefresh);

  useEffect(() => {
    needRefreshListeners.push(setState);
    return () => {
      needRefreshListeners = needRefreshListeners.filter((l) => l !== setState);
    };
  }, []);

  return {
    needRefresh: state,
    applyUpdate: () => {
      void updateSW(true);
    },
  };
}
