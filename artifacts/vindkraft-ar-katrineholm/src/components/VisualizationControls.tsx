import { useState } from "react";
import { shadowFlickerActive, type SunMode, type VisibilityLevel } from "@/lib/visualizationTypes";

const SHADOW_FLICKER_INFO_TEXT =
  "Skuggflimmer är den blinkande skugga som kan uppstå när solen passerar bakom roterande rotorblad. Visualiseringen är en förenklad uppskattning och inte en exakt beräkning.";

interface VisualizationControlsProps {
  sunMode: SunMode;
  onSunModeChange: (mode: SunMode) => void;
  realScale: boolean;
  onRealScaleChange: (value: boolean) => void;
  visibility: VisibilityLevel;
  onVisibilityChange: (value: VisibilityLevel) => void;
  visibilityOpen: boolean;
  onToggleVisibilityOpen: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  nightMode: boolean;
  onToggleNightMode: () => void;
  shadowFlicker: boolean;
  onToggleShadowFlicker: () => void;
  showHiddenTurbines: boolean;
  onToggleShowHiddenTurbines: () => void;
  showSensorDebug: boolean;
  onToggleSensorDebug: () => void;
  onClose: () => void;
}

const SUN_MODES: { value: SunMode; label: string; emoji: string }[] = [
  { value: "current", label: "Aktuell sol", emoji: "☀️" },
  { value: "low", label: "Låg sol", emoji: "🌅" },
  { value: "evening", label: "Kväll", emoji: "🌙" },
  { value: "none", label: "Ingen skugga", emoji: "🚫" },
];

const VISIBILITY_OPTIONS: { value: VisibilityLevel; label: string }[] = [
  { value: "clear", label: "Klart väder" },
  { value: "haze", label: "Dis" },
  { value: "fog", label: "Dimma" },
];

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3 py-3 text-sm font-medium transition ${
        active
          ? "border-[#FF8B01] bg-[#FF8B01] text-[#090909] shadow-lg shadow-[#FF8B01]/30"
          : "border-white/15 bg-white/5 text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

export function VisualizationControls({
  sunMode,
  onSunModeChange,
  realScale,
  onRealScaleChange,
  visibility,
  onVisibilityChange,
  visibilityOpen,
  onToggleVisibilityOpen,
  soundOn,
  onToggleSound,
  nightMode,
  onToggleNightMode,
  shadowFlicker,
  onToggleShadowFlicker,
  showHiddenTurbines,
  onToggleShowHiddenTurbines,
  showSensorDebug,
  onToggleSensorDebug,
  onClose,
}: VisualizationControlsProps) {
  const [shadowFlickerInfoOpen, setShadowFlickerInfoOpen] = useState(false);
  const flickerActive = shadowFlickerActive(shadowFlicker, sunMode);
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-[#FF8B01]/30 bg-[#141210] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 text-white shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
        </div>

        <h2 className="mb-3 text-base font-semibold text-[#FFB347]">Visualiseringsläge</h2>
        <div className="mb-2 grid grid-cols-2 gap-2">
          {SUN_MODES.map((m) => (
            <SegButton key={m.value} active={sunMode === m.value} onClick={() => onSunModeChange(m.value)}>
              {m.emoji} {m.label}
            </SegButton>
          ))}
        </div>

        {sunMode === "low" && (
          <p className="mb-2 rounded-xl border border-[#FF8B01]/30 bg-[#FF8B01]/10 p-3 text-xs leading-relaxed text-[#FFB347]">
            Vid låg sol kan skuggan från ett 250 meter högt vindkraftverk sträcka sig flera kilometer.
            Visualiseringen är ungefärlig.
          </p>
        )}
        {(sunMode === "current" || sunMode === "low") && (
          <p className="mb-4 text-[11px] leading-relaxed text-white/50">
            Skuggor visas som ungefärlig visualisering, inte som exakt skuggberäkning.
          </p>
        )}
        {sunMode !== "current" && sunMode !== "low" && <div className="mb-4" />}

        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-base font-semibold text-[#FFB347]">🌗 Skuggflimmer</h2>
          <button
            onClick={() => setShadowFlickerInfoOpen((v) => !v)}
            aria-pressed={shadowFlickerInfoOpen}
            aria-label="Om skuggflimmer"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[11px] text-white/80 hover:bg-white/20"
          >
            i
          </button>
        </div>
        {shadowFlickerInfoOpen && (
          <p className="mb-2 rounded-xl border border-[#FF8B01]/30 bg-[#FF8B01]/10 p-3 text-xs leading-relaxed text-[#FFB347]">
            {SHADOW_FLICKER_INFO_TEXT}
          </p>
        )}
        <div className="mb-1 grid grid-cols-2 gap-2">
          <SegButton active={shadowFlicker} onClick={() => !shadowFlicker && onToggleShadowFlicker()}>
            🌗 Skuggflimmer PÅ
          </SegButton>
          <SegButton active={!shadowFlicker} onClick={() => shadowFlicker && onToggleShadowFlicker()}>
            🚫 Skuggflimmer AV
          </SegButton>
        </div>
        <p className="-mt-2 mb-4 text-[11px] leading-relaxed text-white/50">
          {sunMode === "current" || sunMode === "low"
            ? flickerActive
              ? "Aktivt — visas när verket har en beräknad markskugga."
              : "Slå på för att visa flimrande rotorbladsskuggor."
            : "Kräver soläge \"Aktuell sol\" eller \"Låg sol\" för att aktiveras."}
        </p>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <SegButton active={realScale} onClick={() => onRealScaleChange(!realScale)}>
            📏 Verklig storlek
          </SegButton>
          <SegButton active={visibilityOpen} onClick={onToggleVisibilityOpen}>
            👁️ Synlighet
          </SegButton>
        </div>
        <p className="-mt-2 mb-4 text-[11px] text-white/50">
          {realScale ? "Skala: verklig storlek, ungefärlig GPS/kompass" : "Skala: förstärkt visning"}
        </p>

        {visibilityOpen && (
          <div className="mb-4 grid grid-cols-3 gap-2">
            {VISIBILITY_OPTIONS.map((v) => (
              <SegButton key={v.value} active={visibility === v.value} onClick={() => onVisibilityChange(v.value)}>
                {v.label}
              </SegButton>
            ))}
          </div>
        )}

        <h2 className="mb-3 text-base font-semibold text-[#FFB347]">👁️ Skymd sikt</h2>
        <div className="mb-1 grid grid-cols-2 gap-2">
          <SegButton active={showHiddenTurbines} onClick={() => !showHiddenTurbines && onToggleShowHiddenTurbines()}>
            👻 Visa skymt (standard)
          </SegButton>
          <SegButton active={!showHiddenTurbines} onClick={() => showHiddenTurbines && onToggleShowHiddenTurbines()}>
            🎯 Dölj helt
          </SegButton>
        </div>
        <p className="-mt-2 mb-4 text-[11px] leading-relaxed text-white/50">
          {showHiddenTurbines
            ? "Standardläge: skymda delar av verken (t.ex. bakom träd/byggnader) visas som glesa, röda halvtransparenta konturer istället för att bara försvinna."
            : "Skymda delar döljs helt bakom det som faktiskt skymmer dem — bara den fritt synliga delen av verket visas."}
        </p>

        <h2 className="mb-3 text-base font-semibold text-[#FFB347]">Nattläge</h2>
        <div className="mb-1 grid grid-cols-2 gap-2">
          <SegButton active={nightMode} onClick={() => !nightMode && onToggleNightMode()}>
            🌙 Nattläge PÅ
          </SegButton>
          <SegButton active={!nightMode} onClick={() => nightMode && onToggleNightMode()}>
            ☀️ Dagsläge
          </SegButton>
        </div>
        <p className="-mt-2 mb-4 text-[11px] text-white/50">
          Styr blinkande flyghinderljus och mörkläggning manuellt — ändras inte automatiskt med klockan.
        </p>

        <h2 className="mb-3 text-base font-semibold text-[#FFB347]">🐞 Sensordebug</h2>
        <div className="mb-1 grid grid-cols-2 gap-2">
          <SegButton active={showSensorDebug} onClick={() => !showSensorDebug && onToggleSensorDebug()}>
            🐞 Panel PÅ
          </SegButton>
          <SegButton active={!showSensorDebug} onClick={() => showSensorDebug && onToggleSensorDebug()}>
            🚫 Panel AV
          </SegButton>
        </div>
        <p className="-mt-2 mb-4 text-[11px] leading-relaxed text-white/50">
          Visar GPS-/kompassprecision, AR-spårningsläge, horisontoffset och antal synliga verk — för felsökning, inte
          för vanligt bruk.
        </p>

        <h2 className="mb-3 text-base font-semibold text-[#FFB347]">Ljud</h2>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <SegButton active={soundOn} onClick={() => !soundOn && onToggleSound()}>
            🔊 Ljud PÅ
          </SegButton>
          <SegButton active={!soundOn} onClick={() => soundOn && onToggleSound()}>
            🔇 Ljud AV
          </SegButton>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-full border border-white/15 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
        >
          Stäng
        </button>
      </div>
    </div>
  );
}
