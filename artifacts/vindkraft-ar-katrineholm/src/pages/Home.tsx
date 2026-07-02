import { useCallback, useMemo, useState } from "react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { useCameraStream } from "@/hooks/useCameraStream";
import { useWindSound } from "@/hooks/useWindSound";
import { CameraBackground } from "@/components/CameraBackground";
import { ARScene } from "@/components/ARScene";
import { MapView } from "@/components/MapView";
import { PetitionModal } from "@/components/PetitionModal";
import { PermissionGate } from "@/components/PermissionGate";
import { TURBINES } from "@/lib/turbines";
import { isNightTime } from "@/lib/geo";

export default function Home() {
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showPetition, setShowPetition] = useState(false);
  const [calibrated, setCalibrated] = useState(false);

  const geo = useGeolocation(started);
  const orientation = useDeviceOrientation(started);
  const camera = useCameraStream(started);
  const wind = useWindSound();

  const errors = useMemo(
    () => [geo.error, orientation.error, camera.error].filter((e): e is string => Boolean(e)),
    [geo.error, orientation.error, camera.error],
  );

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
  const night = isNightTime();

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black text-emerald-50">
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
            />
          )}

          {!ready && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 px-8 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
              <p className="text-sm text-emerald-100">
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
              <span className="rounded-full bg-emerald-500/90 px-4 py-1.5 text-xs font-medium text-emerald-950 shadow-lg">
                Horisont kalibrerad!
              </span>
            </div>
          )}

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
            <div>
              <p className="text-xs font-semibold tracking-wide text-emerald-300">VINDKRAFT AR</p>
              <p className="text-sm text-emerald-50/90">Katrineholm · {TURBINES.length} verk</p>
            </div>
            <div className="flex items-center gap-2">
              {night && (
                <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-[11px] text-red-200">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  Nattläge
                </span>
              )}
              {ready && (
                <button
                  onClick={handleCalibrate}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-emerald-50 transition hover:bg-white/20"
                >
                  Kalibrera horisont
                </button>
              )}
              <button
                onClick={wind.toggle}
                aria-pressed={wind.playing}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  wind.playing ? "bg-emerald-500 text-emerald-950" : "bg-white/10 text-emerald-50"
                }`}
              >
                {wind.playing ? "Vindljud på" : "Vindljud av"}
              </button>
            </div>
          </div>

          {/* Bottom controls */}
          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
            <button
              onClick={() => setShowPetition(true)}
              className="w-full rounded-full bg-emerald-500 py-3.5 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/30 hover:bg-emerald-400"
            >
              Skriv under för folkomröstning
            </button>
            <button
              onClick={() => setShowMap(true)}
              className="w-full rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-emerald-50 hover:bg-white/10"
            >
              Visa karta
            </button>
          </div>
        </>
      )}

      {showMap && (
        <MapView turbines={TURBINES} userLat={geo.lat} userLon={geo.lon} onClose={() => setShowMap(false)} />
      )}
      {showPetition && <PetitionModal onClose={() => setShowPetition(false)} />}
    </div>
  );
}
