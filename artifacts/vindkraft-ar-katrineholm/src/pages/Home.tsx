import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { useCameraStream } from "@/hooks/useCameraStream";
import { useWindSound } from "@/hooks/useWindSound";
import { useSkyDetection } from "@/hooks/useSkyDetection";
import { CameraBackground } from "@/components/CameraBackground";
import { ARScene, type ARSceneHandle } from "@/components/ARScene";
import { MapView } from "@/components/MapView";
import { PetitionModal } from "@/components/PetitionModal";
import { PermissionGate } from "@/components/PermissionGate";
import { InfoPanel } from "@/components/InfoPanel";
import { VisualizationControls } from "@/components/VisualizationControls";
import { SoundLevelPanel, SoundLevelBadge } from "@/components/SoundLevelPanel";
import { NoiseImpactBadge, NoiseImpactPanel } from "@/components/NoiseImpactMonitor";
import { PhotoMontageModal } from "@/components/PhotoMontageModal";
import { InAppBrowserNotice } from "@/components/InAppBrowserNotice";
import { inAppBrowserName, isInAppBrowser } from "@/lib/browserDetection";
import { TURBINES } from "@/lib/turbines";
import { distanceMeters, bearingDegrees, isNightTime } from "@/lib/geo";
import { swerefToWgs84 } from "@/lib/sweref";
import { getBladeRpm } from "@/lib/turbineAnimation";
import { estimateSoundLevel } from "@/lib/soundLevel";
import { estimateNoiseImpact } from "@/lib/noiseImpact";
import { useWindDirection } from "@/hooks/useWindDirection";
import type { SunMode, VisibilityLevel } from "@/lib/visualizationTypes";

const PHOTO_WATERMARK_TEXT = "Katrineholm FRAMÅT – Vindkraft AR";
const PHOTO_DISCLAIMER_TEXT = "Fotomontage/visualisering. GPS, kompass, terräng, väder och sikt kan påverka precisionen.";

const AVG_RPM = TURBINES.reduce((sum, t) => sum + getBladeRpm(t.name), 0) / TURBINES.length;

export default function Home() {
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showPetition, setShowPetition] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [showSoundLevel, setShowSoundLevel] = useState(true);
  const [showNoiseImpact, setShowNoiseImpact] = useState(false);

  const [sunMode, setSunMode] = useState<SunMode>("current");
  const [realScale, setRealScale] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityLevel>("clear");
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  // Startvärdet matchar den faktiska klockan vid appstart, men efter det är
  // läget helt manuellt — ingen bakgrundstimer skriver över användarens val.
  const [nightMode, setNightMode] = useState(() => isNightTime());
  const [shadowFlicker, setShadowFlicker] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [inApp] = useState(() => (typeof navigator !== "undefined" ? isInAppBrowser() : false));
  const [appName] = useState(() => (typeof navigator !== "undefined" ? inAppBrowserName() : ""));

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const arSceneRef = useRef<ARSceneHandle | null>(null);

  const geo = useGeolocation(started);
  const orientation = useDeviceOrientation(started);
  const camera = useCameraStream(started);
  const wind = useWindSound();
  // Kamerabaserad himmel/inomhus-heuristik (se `useSkyDetection`s jsdoc för
  // begränsningar) — styr både AR-verkens synlighet (via `isPointSky`,
  // skickas till ARScene) och dämpningen av vindljudet/dBA-uppskattningen
  // nedan när användaren bedöms vara inomhus.
  const sky = useSkyDetection(videoElRef, started);

  const errors = useMemo(
    () => [geo.error, orientation.error, camera.error].filter((e): e is string => Boolean(e)),
    [geo.error, orientation.error, camera.error],
  );

  // Beräknar en informativ dBA-uppskattning baserat på GPS-avstånd till
  // samtliga verk. Rent visningssyfte — styr aldrig ljuduppspelningen.
  // `sky.outdoorConfidence` dämpar uppskattningen live när användaren
  // bedöms vara inomhus (se `estimateSoundLevel`).
  const soundLevelEstimate = useMemo(() => {
    if (geo.lat === null || geo.lon === null) {
      return { totalDba: -Infinity, nearestDistanceM: null, contributingCount: 0 };
    }
    const distances = TURBINES.map((t) => {
      const { lat, lon } = swerefToWgs84(t.easting, t.northing);
      return distanceMeters(geo.lat as number, geo.lon as number, lat, lon);
    });
    return estimateSoundLevel(distances, sky.outdoorConfidence);
  }, [geo.lat, geo.lon, sky.outdoorConfidence]);

  // Vindriktning (informativ, om tillgänglig) för infraljud-/bullermonitorn
  // nedan — hämtas från ett fritt väder-API, degraderar tyst till "okänd"
  // om nätverket saknas.
  const windDirection = useWindDirection(geo.lat, geo.lon);

  // Exponeringstid: hur länge användaren sammanhängande har stått i AR-vyn
  // med GPS-fix, för att låta monitorn väga in längre vistelser. Nollställs
  // om GPS-fixet tappas och sedan återfås (ny "session" på platsen).
  const exposureStartRef = useRef<number | null>(null);
  const [exposureNowTick, setExposureNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (geo.lat === null || geo.lon === null) {
      exposureStartRef.current = null;
      return;
    }
    if (exposureStartRef.current === null) {
      exposureStartRef.current = Date.now();
    }
    const interval = window.setInterval(() => setExposureNowTick(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [geo.lat, geo.lon]);

  const noiseImpact = useMemo(() => {
    const nearest = TURBINES.reduce<{ dist: number; bearing: number } | null>((closest, t) => {
      if (geo.lat === null || geo.lon === null) return closest;
      const { lat, lon } = swerefToWgs84(t.easting, t.northing);
      const dist = distanceMeters(geo.lat, geo.lon, lat, lon);
      if (!closest || dist < closest.dist) {
        return { dist, bearing: bearingDegrees(geo.lat, geo.lon, lat, lon) };
      }
      return closest;
    }, null);

    const exposureSeconds =
      exposureStartRef.current !== null ? (exposureNowTick - exposureStartRef.current) / 1000 : 0;

    return estimateNoiseImpact({
      estimate: soundLevelEstimate,
      bearingToNearestDeg: nearest?.bearing ?? null,
      windFromDeg: windDirection.windFromDeg,
      exposureSeconds,
    });
  }, [soundLevelEstimate, geo.lat, geo.lon, windDirection.windFromDeg, exposureNowTick]);

  // Uppdatera vindljudets volym/svischtakt när GPS-position ändras. Alla
  // verks avstånd skickas med (inte bara det närmaste) så att flera
  // närliggande verk kombineras till ett kraftigare, tätare ljudlandskap.
  // `sky.outdoorConfidence` tonar ned ljudet helt (0 = tyst) när användaren
  // bedöms vara inomhus, och tillbaka upp live så fort hen går ut igen.
  useEffect(() => {
    if (!wind.playing || geo.lat === null || geo.lon === null) return;
    const distances = TURBINES.map((t) => {
      const { lat, lon } = swerefToWgs84(t.easting, t.northing);
      return distanceMeters(geo.lat as number, geo.lon as number, lat, lon);
    });
    wind.updateProximity(distances, AVG_RPM, sky.outdoorConfidence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wind.playing, geo.lat, geo.lon, sky.outdoorConfidence]);

  const handleStart = useCallback(() => {
    setStarting(true);
    // Ljud på som standard: startas direkt från samma knapptryckning (giltigt
    // användargest för iOS Safaris ljuduppspelningsregler), innan ev. await
    // nedan, så AudioContext skapas/låses upp synkront i gestens "kontext".
    void wind.toggle();

    // VIKTIGT: GPS- och kamerabehörighet måste begäras SYNKRONT i samma
    // knapptryckning som utlöser dem — precis som ljudet ovan. iOS Safari
    // (och flera Android-webbläsare) räknar bara knappklicket som en giltig
    // "user gesture" en mycket kort stund. Om vi (som tidigare) väntar
    // (await) på kompassbehörigheten FÖRST, och först därefter — via
    // setStarted(true) och en efterföljande render/effekt — begär GPS och
    // kamera, hinner gest-fönstret stängas. Resultatet blir att webbläsaren
    // tyst nekar GPS/kamera utan att någonsin visa behörighetsdialogen,
    // vilket var precis vad testaren (Stephane) upplevde. Genom att trigga
    // alla tre förfrågningar parallellt, direkt här, ligger de alla kvar
    // inom samma giltiga gest-fönster.
    navigator.geolocation?.getCurrentPosition(
      () => {},
      () => {},
      { enableHighAccuracy: true, timeout: 15000 },
    );
    navigator.mediaDevices
      ?.getUserMedia?.({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => {});

    const finish = () => {
      setStarted(true);
      setStarting(false);
    };

    if (orientation.needsPermission) {
      void orientation.requestPermission().finally(finish);
    } else {
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation]);

  const handleCalibrate = useCallback(() => {
    orientation.calibrateHorizon();
    setCalibrated(true);
    window.setTimeout(() => setCalibrated(false), 1800);
  }, [orientation]);

  // Fotomontage: sammanfogar kameraströmmens aktuella bildruta med Three.js-
  // scenens canvas (som redan innehåller vindkraftverk, namn/avstånds-
  // etiketter, skuggor, sol och valt visualiseringsläge) till en enda bild,
  // och ritar sedan på vattenstämpel + ansvarsfriskrivning. Görs helt lokalt
  // i en dold <canvas> — inga externa bibliotek eller nätverksanrop.
  const handleCapturePhoto = useCallback(async () => {
    setPhotoError(null);
    try {
      const video = videoElRef.current;
      if (!video || !arSceneRef.current) {
        setPhotoError("Kunde inte ta bild — kameran eller AR-vyn är inte redo.");
        return;
      }
      // Fångar AR-scenens canvas via ARScene:s imperativa handtag (synkront
      // efter nästa renderade bildruta) istället för en delad `canvasRef`
      // + `preserveDrawingBuffer`, se motivering i ARScene.tsx.
      const arDataUrl = await arSceneRef.current.capturePhoto();
      if (!arDataUrl) {
        setPhotoError("Kunde inte ta bild — AR-vyn är inte redo.");
        return;
      }
      const arImage = new Image();
      await new Promise<void>((resolve, reject) => {
        arImage.onload = () => resolve();
        arImage.onerror = () => reject(new Error("ar-image-load-failed"));
        arImage.src = arDataUrl;
      });

      const width = video.videoWidth || arImage.width || 1080;
      const height = video.videoHeight || arImage.height || 1920;

      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const ctx = out.getContext("2d");
      if (!ctx) {
        setPhotoError("Kunde inte ta bild — canvas stöds inte.");
        return;
      }

      // Kamerabild (object-cover-liknande beskärning så proportionerna
      // matchar det som faktiskt syns på skärmen).
      const videoAspect = video.videoWidth / video.videoHeight || width / height;
      const targetAspect = width / height;
      let sx = 0;
      let sy = 0;
      let sw = video.videoWidth || width;
      let sh = video.videoHeight || height;
      if (videoAspect > targetAspect) {
        sw = sh * targetAspect;
        sx = ((video.videoWidth || width) - sw) / 2;
      } else {
        sh = sw / targetAspect;
        sy = ((video.videoHeight || height) - sh) / 2;
      }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);

      // AR-scenen (vindkraftverk, etiketter, sol, skuggor) — bilden har
      // alpha-transparent bakgrund, så kamerabilden lyser igenom naturligt.
      ctx.drawImage(arImage, 0, 0, width, height);

      // Vattenstämpel.
      const pad = Math.round(width * 0.035);
      ctx.textBaseline = "alphabetic";
      ctx.font = `600 ${Math.round(width * 0.032)}px Inter, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(PHOTO_WATERMARK_TEXT, pad + 1, height - pad + 1);
      ctx.fillStyle = "#FF8B01";
      ctx.fillText(PHOTO_WATERMARK_TEXT, pad, height - pad);

      // Ansvarsfriskrivning längst ned, på egen rad med halvtransparent fält
      // för läsbarhet oavsett bakgrund.
      const disclaimerFontSize = Math.round(width * 0.02);
      ctx.font = `400 ${disclaimerFontSize}px Inter, sans-serif`;
      const barHeight = disclaimerFontSize * 2.6;
      ctx.fillStyle = "rgba(9,9,9,0.55)";
      ctx.fillRect(0, height - barHeight, width, barHeight);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.textAlign = "center";
      ctx.fillText(PHOTO_DISCLAIMER_TEXT, width / 2, height - barHeight / 2 + disclaimerFontSize / 3);

      setCapturedPhoto(out.toDataURL("image/png"));
    } catch {
      setPhotoError("Kunde inte skapa fotomontage. Försök igen.");
    }
  }, []);

  const ready = started && geo.lat !== null && geo.lon !== null && orientation.hasFix && camera.stream;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#090909] text-white">
      {!started && (
        <PermissionGate onStart={handleStart} starting={starting} errors={errors} turbineCount={TURBINES.length} />
      )}

      {started && (
        <>
          <CameraBackground stream={camera.stream} videoRef={videoElRef} />

          {ready && (
            <ARScene
              ref={arSceneRef}
              userLat={geo.lat!}
              userLon={geo.lon!}
              quaternionRef={orientation.quaternionRef}
              turbines={TURBINES}
              sunMode={sunMode}
              realScale={realScale}
              visibility={visibility}
              nightMode={nightMode}
              shadowFlicker={shadowFlicker}
              isPointSky={sky.isPointSky}
            />
          )}

          {/* Dagsläge stänger av mörkläggningen helt, oavsett vilket
              visualiseringsläge (t.ex. "Kväll") som är valt — bara det
              manuella Nattläge-valet styr detta filter. */}
          {ready && nightMode && (
            <div className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-b from-[#0a1030]/55 via-[#0a1030]/35 to-[#0a1030]/60" />
          )}

          {/* Väntar-overlayen döljs om kameran istället bedöms visa en
              inomhusmiljö (se "Gå utomhus"-overlayen nedan) — annars
              skulle användaren se en evig snurrande laddningsindikator
              istället för en tydlig förklaring till varför AR-vyn inte
              startar. */}
          {!ready && !(sky.ready && sky.indoors) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 px-8 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF8B01] border-t-transparent" />
              <p className="text-sm text-white/90">
                {!camera.stream && "Startar kameran…"}
                {camera.stream && geo.lat === null && "Hämtar GPS-position…"}
                {camera.stream && geo.lat !== null && !orientation.hasFix && "Läser av kompass — rör telefonen i en åtta-rörelse."}
              </p>
              {errors.length > 0 && (
                <div className="mt-2 flex w-full max-w-xs flex-col gap-3">
                  <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
                    {errors.map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                    {geo.permissionDenied && (
                      <p className="mt-2 text-[11px] text-red-200/70">
                        Tips: Om du redan nekat platsbehörighet frågar inte webbläsaren igen automatiskt. Gå
                        till telefonens inställningar för Safari/Chrome → Webbplatsinställningar för den här
                        sidan → tillåt Plats, och tryck sedan Försök igen.
                      </p>
                    )}
                  </div>
                  {geo.error && (
                    <button
                      onClick={geo.retry}
                      className="w-full rounded-full bg-[#FF8B01] py-2.5 text-xs font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/20 transition hover:bg-[#FFB347]"
                    >
                      🔄 Försök igen med platsåtkomst
                    </button>
                  )}
                  {inApp && <InAppBrowserNotice appName={appName} />}
                </div>
              )}
            </div>
          )}

          {/* "Gå utomhus"-overlay: visas oberoende av `ready` (dvs. även
              medan GPS/kompass fortfarande söker fix) så fort kamerabilden
              tolkas som en inomhusmiljö — turbinerna skulle ändå tonas bort
              i AR-vyn (se ARScene/`isPointSky`) och ljudet redan vara tyst
              (se `sky.outdoorConfidence` ovan), så detta ger en tydlig,
              stor förklaring istället för en till synes tom/livlös vy. */}
          {started && sky.ready && sky.indoors && (
            <div className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-4 bg-black/70 px-8 text-center">
              <span className="text-5xl">🏠➡️🌤️</span>
              <p className="text-lg font-semibold text-white">Gå utomhus för att se vindkraftverken</p>
              <p className="max-w-xs text-sm text-white/70">
                Kameran verkar just nu inte ha fri sikt mot himlen. AR-vyn och ljudet fungerar bara utomhus, med
                fri sikt över horisonten.
              </p>
            </div>
          )}

          {ready && calibrated && (
            <div className="pointer-events-none absolute inset-x-0 top-32 z-30 flex justify-center">
              <span className="rounded-full bg-[#FF8B01]/90 px-4 py-1.5 text-xs font-medium text-[#090909] shadow-lg">
                Horisont kalibrerad!
              </span>
            </div>
          )}

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 z-20 flex flex-col gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#FFB347]">VINDKRAFT AR</p>
                <p className="text-sm text-white/90">Katrineholm · {TURBINES.length} verk</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <SoundLevelBadge estimate={soundLevelEstimate} indoors={sky.ready && sky.indoors} />
                <NoiseImpactBadge
                  result={noiseImpact}
                  expanded={showNoiseImpact}
                  onToggle={() => setShowNoiseImpact((v) => !v)}
                />
                <button
                  onClick={() => setShowControls(true)}
                  aria-pressed={showControls}
                  className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
                >
                  ⚙️ Visning
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              {ready && (
                <button
                  onClick={() => setShowSoundLevel((v) => !v)}
                  aria-pressed={showSoundLevel}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 aria-pressed:bg-[#FF8B01]/25 aria-pressed:text-[#FFB347]"
                >
                  🔊 Ljudnivå
                </button>
              )}
            </div>
          </div>

          {ready && photoError && (
            <div className="pointer-events-none absolute inset-x-0 top-[7.5rem] z-30 flex justify-center px-4">
              <span className="rounded-full bg-red-500/20 px-4 py-1.5 text-xs text-red-200 shadow-lg">{photoError}</span>
            </div>
          )}

          {/* Bottom controls */}
          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
            {ready && showSoundLevel && (
              <SoundLevelPanel
                estimate={soundLevelEstimate}
                indoors={sky.ready && sky.indoors}
                onClose={() => setShowSoundLevel(false)}
              />
            )}
            {ready && showNoiseImpact && (
              <NoiseImpactPanel result={noiseImpact} onClose={() => setShowNoiseImpact(false)} />
            )}
            <button
              onClick={() => setShowPetition(true)}
              className="w-full rounded-full bg-[#FF8B01] py-3.5 text-sm font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/30 hover:bg-[#FFB347]"
            >
              Jag vill skriva på för att få till folkomröstning
            </button>
            {ready && (
              <button
                onClick={handleCapturePhoto}
                className="w-full rounded-full border border-[#FF8B01]/40 bg-[#FF8B01]/10 py-3 text-sm font-semibold text-[#FFB347] hover:bg-[#FF8B01]/20"
              >
                📸 Fotomontage
              </button>
            )}
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
      {capturedPhoto && (
        <PhotoMontageModal
          imageDataUrl={capturedPhoto}
          onRetake={() => {
            setCapturedPhoto(null);
            handleCapturePhoto();
          }}
          onClose={() => setCapturedPhoto(null)}
        />
      )}
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
          shadowFlicker={shadowFlicker}
          onToggleShadowFlicker={() => setShadowFlicker((v) => !v)}
          onClose={() => setShowControls(false)}
        />
      )}
    </div>
  );
}
