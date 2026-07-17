import { useState } from "react";
import { inAppBrowserName, isInAppBrowser } from "@/lib/browserDetection";
import { InAppBrowserNotice } from "@/components/InAppBrowserNotice";
import { openSverigekartan } from "@/lib/capacitorBridge";

/** Ändra VERSION och BUILD_LABEL inför varje ny native-testbygge. Ta bort inför release. */
const VERSION = "18";
const BUILD_LABEL = "🧪 Native TEST 18";
const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? "";
const SHORT_HASH = BUILD_ID.split("@")[0] ?? "";

interface PermissionGateProps {
  onStart: () => void;
  starting: boolean;
  errors: string[];
  turbineCount: number;
}

export function PermissionGate({ onStart, starting, errors, turbineCount }: PermissionGateProps) {
  const [inApp] = useState(() => (typeof navigator !== "undefined" ? isInAppBrowser() : false));
  const [appName] = useState(() => (typeof navigator !== "undefined" ? inAppBrowserName() : ""));

  return (
    <div
      className={`absolute inset-0 z-30 flex flex-col overflow-y-auto bg-[#090909] px-6 text-white ${inApp ? "pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]" : "pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]"}`}
      style={{ overscrollBehavior: "none" }}
    >
      <div className="mx-auto w-full max-w-md text-center">
        {/*
          Logotyp för Katrineholm FRAMÅT (transparent SVG). Om en ny logotypfil finns, lägg den i
          public/logo.svg (ersätter den nuvarande) — <img> nedan används automatiskt då.
          Faller tillbaka till textbaserad logotyp om bilden saknas.
        */}
        <div
          className={`mx-auto flex flex-col items-center justify-center ${inApp ? "hidden" : ""}`}
          role="img"
          aria-label="Katrineholm FRAMÅT"
        >
          <img
            src="/logo.svg"
            alt="Katrineholm FRAMÅT"
            className="h-20 w-auto object-contain"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = "block";
            }}
          />
          <span className="hidden text-center leading-tight tracking-wide">
            <span className="block text-2xl font-semibold text-white">Katrineholm</span>
            <span className="block text-4xl font-black uppercase text-[#FF8B01]">FRAMÅT</span>
          </span>
        </div>

        <h1 className={`font-bold leading-tight text-white ${inApp ? "text-xl" : "mt-6 text-3xl"}`}>Vindkraft AR</h1>

        {/*
          I en in-app-webbläsare (Messenger m.fl.) visas notisen om att öppna
          i Safari/Chrome direkt under rubriken, och resten av introt (bild,
          taggen, brödtext) hoppas över helt — annars hamnar "Kopiera
          länk"-knappen under vikningen och användaren måste scrolla för att
          hitta den enda knapp som faktiskt fungerar i den webbläsaren.
        */}
        {inApp ? (
          <div className="mt-3">
            <InAppBrowserNotice appName={appName} />
          </div>
        ) : (
          <>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#FF8B01]/15 px-3 py-1 text-xs font-medium text-[#FFB347]">
              📱 Kräver mobiltelefon — rikta mobilkameran runt dig
            </p>

            <p className="mt-4 text-sm leading-relaxed text-white/70">
              Visualisera hur de planerade vindkraftverken kan komma att upplevas från olika platser i
              Katrineholm.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              Appen använder kameran, GPS och mobilens kompass för att placera vindkraftverken i rätt riktning
              och på ungefär rätt avstånd.
            </p>
          </>
        )}
      </div>

      <div className={`mx-auto mt-auto w-full max-w-md space-y-4 ${inApp ? "pt-4" : "pt-8"}`}>
        {!inApp && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <p className="mb-2 font-medium text-white">Appen behöver tillgång till:</p>
            <ul className="space-y-1.5">
              <li>📷 Kamera — för att visa verkligheten i bakgrunden</li>
              <li>📍 Plats (GPS) — för att räkna ut avstånd och riktning</li>
              <li>🧭 Kompass — för att veta vart du tittar</li>
            </ul>
            <p className="mt-2 text-xs text-white/40">{turbineCount} planerade vindkraftverk visas i vyn.</p>
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
            {!inApp && errors.some((e) => /denied|nekad|permission/i.test(e)) && (
              <p className="mt-2 text-[12px] text-red-200/70">
                Tips: Om du redan nekat behörighet tidigare frågar inte webbläsaren igen automatiskt. Gå till
                telefonens inställningar för Safari/Chrome → Webbplatsinställningar för den här sidan → tillåt
                Kamera och Plats, och ladda om sidan.
              </p>
            )}
          </div>
        )}

        {/*
          I in-app-webbläsaren kan kamera/GPS ändå oftast inte startas, så
          knappen och underlagets fotnoter tar bara upp värdefull yta ovanför
          vikningen utan att vara till nytta — döljs tills länken öppnats i en
          riktig webbläsare.
        */}
        {!inApp && (
          <>
            <button
              onClick={() => {
                console.log("[AR] Start button pressed - PermissionGate onClick fired");
                onStart();
              }}
              disabled={starting}
              className="w-full rounded-full bg-[#FF8B01] py-4 text-base font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/20 transition hover:bg-[#FFB347] disabled:opacity-60"
            >
              {starting ? "Startar…" : "📷 Starta AR"}
            </button>
            <button
              onClick={openSverigekartan}
              disabled={starting}
              className="w-full rounded-full border border-white/20 bg-white/5 py-3.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-60"
            >
              🗺️ Sverigekartan – Öppna kartverktyg
            </button>
            <p className="text-center text-[11px] text-white/40">
              Sverigekartan visar alla planerade vindkraftverk i Sverige. Klicka på ett projekt och välj Redigera eller Visa i AR — kräver ingen kamera, GPS eller kompass.
            </p>
            <p className="text-center text-[11px] text-white/30">
              Fungerar bäst utomhus, i dagsljus eller kväll, med fri sikt mot horisonten.
            </p>
            {BUILD_LABEL && (
              <p className="text-center text-[11px] font-bold text-[#FF8B01]">
                {BUILD_LABEL}
              </p>
            )}
            {SHORT_HASH && (
              <p className="text-center text-[10px] text-white/35 font-mono">
                Version {VERSION} · Build {SHORT_HASH}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
