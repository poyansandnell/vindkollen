import { useCallback, useEffect, useMemo, useState } from "react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { useCameraStream } from "@/hooks/useCameraStream";
import { useWindSound } from "@/hooks/useWindSound";
import { CameraBackground } from "@/components/CameraBackground";
import { ARScene } from "@/components/ARScene";
import { MapView } from "@/components/MapView";
import { PetitionModal } from "@/components/PetitionModal";
import { PermissionGate } from "@/components/PermissionGate";
import { InfoPanel } from "@/components/InfoPanel";
import { VisualizationControls } from "@/components/VisualizationControls";
import { TURBINES } from "@/lib/turbines";
import { distanceMeters, isNightTime } from "@/lib/geo";
import { swerefToWgs84 } from "@/lib/sweref";
import { getBladeRpm } from "@/lib/turbineAnimation";
import type { SunMode, VisibilityLevel } from "@/lib/visualizationTypes";

const AVG_RPM = TURBINES.reduce((sum, t) => sum + getBladeRpm(t.name), 0) / TURBINES.length;

export default function Home() {
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showPetition, setShowPetition] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [calibrated, setCalibrated] = useState(false);

  const [sunMode, setSunMode] = useState<SunMode>("current");
  const [realScale, setRealScale] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityLevel>("clear");
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  // Startvärdet matchar den faktiska klockan vid appstart, men efter det är
  // läget helt manuellt — ingen bakgrundstimer skriver över användarens val.
  const [nightMode, setNightMode] = useState(() => isNightTime());

  const geo = useGeolocation(started);
  const orientation = useDeviceOrientation(started);
  const camera = useCameraStream(started);
  const wind = useWindSound();

  const errors = useMemo(
    () => [geo.error, orientation.error, camera.error].filter((e): e is string => Boolean(e)),
    [geo.error, orientation.error, camera.error],
  );

  // Uppdatera vindljudets volym/svischtakt när GPS-position ändras — högre
  // volym ju närmare användaren är närmaste verk, aldrig överdrivet högt.
  useEffect(() => {
    if (!wind.playing || geo.lat === null || geo.lon === null) return;
    let nearest: number | null = null;
    for (const t of TURBINES) {
      const { lat, lon } = swerefToWgs84(t.easting, t.northing);
      const d = distanceMeters(geo.lat, geo.lon, lat, lon);
      if (nearest === null || d < nearest) nearest = d;
    }
    wind.updateProximity(nearest, AVG_RPM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wind.playing, geo.lat, geo.lon]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    if (orientation.needsPermission) {
      await orientation.requestPermission();
    }
    setStarted(true);
    setStarting(false);
  }, [orientation]);

  const handleCalibrate = useCallback(() => {
    orientation.calibrateHorizon();
    setCalibrated(true);
    window.setTimeout(() => setCalibrated(false), 1800);
  }, [orientation]);

  const ready = started && geo.lat !== null && geo.lon !== null && orientation.hasFix && camera.stream;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#090909] text-white">
      {!started && (
        <PermissionGate onStart={handleStart} starting={starting} errors={errors} turbineCount={TURBINES.length} />
      )}

      {started && (
        <>
          <CameraBackground stream={camera.stream} />

          {ready && (
            <ARScene
              userLat={geo.lat!}
              userLon={geo.lon!}
              quaternionRef={orientation.quaternionRef}
              turbines={TURBINES}
              sunMode={sunMode}
              realScale={realScale}
              visibility={visibility}
              nightMode={nightMode}
            />
          )}

          {ready && (nightMode || sunMode === "evening") && (
            <div className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-b from-[#0a1030]/55 via-[#0a1030]/35 to-[#0a1030]/60" />
          )}

          {!ready && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 px-8 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF8B01] border-t-transparent" />
              <p className="text-sm text-white/90">
                {!camera.stream && "Startar kameran…"}
                {camera.stream && geo.lat === null && "Hämtar GPS-position…"}
                {camera.stream && geo.lat !== null && !orientation.hasFix && "Läser av kompass — rör telefonen i en åtta-rörelse."}
              </p>
              {errors.length > 0 && (
                <div className="mt-2 max-w-xs rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
                  {errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {ready && calibrated && (
            <div className="pointer-events-none absolute inset-x-0 top-24 z-30 flex justify-center">
              <span className="rounded-full bg-[#FF8B01]/90 px-4 py-1.5 text-xs font-medium text-[#090909] shadow-lg">
                Horisont kalibrerad!
              </span>
            </div>
          )}

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#FFB347]">VINDKRAFT AR</p>
              <p className="text-sm text-white/90">Katrineholm · {TURBINES.length} verk</p>
            </div>
            <div className="flex items-center gap-2">
              {wind.playing && (
                <span className="flex items-center gap-1.5 rounded-full bg-[#FF8B01]/20 px-2.5 py-1 text-[11px] text-[#FFB347]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FFB347]" />
                  Vindljud aktivt
                </span>
              )}
              {nightMode && (
                <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-[11px] text-red-200">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  Nattläge
                </span>
              )}
              {ready && (
                <button
                  onClick={handleCalibrate}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
                >
                  Kalibrera horisont
                </button>
              )}
              <button
                onClick={() => setShowControls(true)}
                aria-pressed={showControls}
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
              >
                ⚙️ Visning
              </button>
            </div>
          </div>

          {/* Bottom controls */}
          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
            <button
              onClick={() => setShowPetition(true)}
              className="w-full rounded-full bg-[#FF8B01] py-3.5 text-sm font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/30 hover:bg-[#FFB347]"
            >
              Jag vill bli kontaktad
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => setShowMap(true)}
                className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
              >
                Visa karta
              </button>
              <button
                onClick={() => setShowInfo(true)}
                className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
              >
                Om projektet
              </button>
            </div>
          </div>
        </>
      )}

      {showMap && (
        <MapView turbines={TURBINES} userLat={geo.lat} userLon={geo.lon} onClose={() => setShowMap(false)} />
      )}
      {showPetition && <PetitionModal onClose={() => setShowPetition(false)} />}
      {showInfo && <InfoPanel onClose={() => setShowInfo(false)} />}
      {showControls && (
        <VisualizationControls
          sunMode={sunMode}
          onSunModeChange={setSunMode}
          realScale={realScale}
          onRealScaleChange={setRealScale}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          visibilityOpen={visibilityOpen}
          onToggleVisibilityOpen={() => setVisibilityOpen((v) => !v)}
          soundOn={wind.playing}
          onToggleSound={wind.toggle}
          nightMode={nightMode}
          onToggleNightMode={() => setNightMode((v) => !v)}
          onClose={() => setShowControls(false)}
        />
      )}
    </div>
  );
}
