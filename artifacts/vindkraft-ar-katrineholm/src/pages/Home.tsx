import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { useCameraStream } from "@/hooks/useCameraStream";
import { useWindSound } from "@/hooks/useWindSound";
import { useSkyDetection } from "@/hooks/useSkyDetection";
import { useOutdoorConfidenceIndex } from "@/hooks/useOutdoorConfidenceIndex";
import { useStableGeoPosition } from "@/hooks/useStableGeoPosition";
import { useSmoothedGeoPosition } from "@/hooks/useSmoothedGeoPosition";
import { useArTrackingStability, WEAK_SIGNAL_MESSAGE } from "@/hooks/useArTrackingStability";
import { useSmoothedDba } from "@/hooks/useSmoothedDba";
import { CameraBackground } from "@/components/CameraBackground";
import { ARScene, type ARSceneHandle, MAX_RENDER_DISTANCE_M } from "@/components/ARScene";
import { MapView } from "@/components/MapView";
import { PetitionModal } from "@/components/PetitionModal";
import { PermissionGate } from "@/components/PermissionGate";
import { LoadingSequence } from "@/components/LoadingSequence";
import { InfoPanel } from "@/components/InfoPanel";
import { VisualizationControls } from "@/components/VisualizationControls";
import { SensorDebugPanel } from "@/components/SensorDebugPanel";
import { SoundLevelPanel, SoundLevelBadge } from "@/components/SoundLevelPanel";
import { NoiseImpactBadge, NoiseImpactPanel } from "@/components/NoiseImpactMonitor";
import { LineOfSightStatus } from "@/components/LineOfSightStatus";
import { NearestTurbineArrow } from "@/components/NearestTurbineArrow";
import { PhotoMontageModal } from "@/components/PhotoMontageModal";
import { InAppBrowserNotice } from "@/components/InAppBrowserNotice";
import { inAppBrowserName, isInAppBrowser } from "@/lib/browserDetection";
import { TURBINES, type TurbineSweref } from "@/lib/turbines";
import { distanceMeters, bearingDegrees, isNightTime } from "@/lib/geo";
import { swerefToWgs84, wgs84ToSweref } from "@/lib/sweref";
import { getBladeRpm } from "@/lib/turbineAnimation";
import { estimateSoundLevel, dbaToGain, applyIndoorAttenuation, applyIndoorGain } from "@/lib/soundLevel";
import { estimateNoiseImpact } from "@/lib/noiseImpact";
import { useWindDirection } from "@/hooks/useWindDirection";
import type { SunMode, VisibilityLevel } from "@/lib/visualizationTypes";

const PHOTO_WATERMARK_TEXT = "Katrineholm FRAMÅT – Vindkraft AR";
const PHOTO_DISCLAIMER_TEXT = "Fotomontage/visualisering. GPS, kompass, terräng, väder och sikt kan påverka precisionen.";

const AVG_RPM = TURBINES.reduce((sum, t) => sum + getBladeRpm(t.name), 0) / TURBINES.length;

// Nyckeln som "Placera vindkraftverken själv" (`PlaceTurbines.tsx`) skriver
// till när användaren trycker "Se denna placering i AR" — läses här EN gång
// vid montering så AR-vyn kan visa användarens egen Ericsberg-placering
// istället för de 29 planerade Länsterberget-verken. Samma default-mått
// (grundhöjd/navhöjd/rotordiameter) som de riktiga verken, eftersom
// placeringsläget bara samlar in lat/lon, inte verkens fysiska mått.
const AR_HANDOFF_KEY = "vindkraft-ar-katrineholm:customPlacement";

interface StoredPlacement {
  turbines: { id: string; lat: number; lon: number }[];
  savedAt: number;
}

function loadCustomPlacement(): TurbineSweref[] | null {
  try {
    const raw = localStorage.getItem(AR_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlacement;
    if (!Array.isArray(parsed.turbines) || parsed.turbines.length === 0) return null;
    return parsed.turbines.map((t, i) => {
      const { easting, northing } = wgs84ToSweref(t.lat, t.lon);
      return {
        id: t.id,
        name: `Egen V${i + 1}`,
        easting,
        northing,
        heightMeters: 250,
        groundHeightMeters: 60,
        hubHeightMeters: 169,
        rotorDiameterMeters: 162,
        totalHeightAboveSeaMeters: 310,
      };
    });
  } catch {
    return null;
  }
}

export default function Home() {
  const [, navigate] = useLocation();
  const [customTurbines, setCustomTurbines] = useState<TurbineSweref[] | null>(null);
  useEffect(() => {
    setCustomTurbines(loadCustomPlacement());
  }, []);
  const activeTurbines = customTurbines ?? TURBINES;
  const usingCustomPlacement = customTurbines !== null;
  const handleClearCustomPlacement = useCallback(() => {
    localStorage.removeItem(AR_HANDOFF_KEY);
    setCustomTurbines(null);
  }, []);

  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  // Visar den produktkrävda laddningssekvensen direkt efter
  // "Starta visualisering": (1) kompasskalibrering i två steg (liggande,
  // sedan stående — sensorstyrd, se `useDeviceOrientation.ts`s
  // `calibrationPhase`), (2) en 3-2-1-nedräkning med statusmeddelanden,
  // (3) en checklista som bockas av i tur och ordning. Körs parallellt med
  // (inte i väntan på) den riktiga GPS/kompass/kamera-behörighetsflödet
  // nedan; om det äkta `ready`-läget inte hunnit bli klart när sekvensen tar
  // slut visas det befintliga väntar-overlayet (se `!ready`-blocket längre
  // ner) precis som innan.
  const [showLoadingSequence, setShowLoadingSequence] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showPetition, setShowPetition] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showSensorDebug, setShowSensorDebug] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [showSoundLevel, setShowSoundLevel] = useState(true);
  const [showNoiseImpact, setShowNoiseImpact] = useState(false);
  // Explicit manuellt val (INTE kameraheuristiken) för om vindljudet/dBA-
  // uppskattningen ska räkna som "ute" (full nivå) eller "inne" (kraftigt
  // dämpad, se `estimateSoundLevel`s `outdoorConfidence`-parameter nedan).
  // Måste alltid starta som "ute" enligt produktkravet, oavsett vad
  // kameran/tidigare session råkar tycka om miljön.
  const [soundEnvironment, setSoundEnvironment] = useState<"ute" | "inne">("ute");

  const [sunMode, setSunMode] = useState<SunMode>("current");
  const [realScale, setRealScale] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityLevel>("clear");
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  // Startvärdet matchar den faktiska klockan vid appstart, men efter det är
  // läget helt manuellt — ingen bakgrundstimer skriver över användarens val.
  const [nightMode, setNightMode] = useState(() => isNightTime());
  const [shadowFlicker, setShadowFlicker] = useState(false);
  // Default PÅ enligt produktkravet: skymda verksdelar (t.ex. bakom träd/
  // byggnader) ska visas som glesa, röda halvtransparenta konturer istället
  // för att bara försvinna helt — annars ser det ut som om ett helt verk
  // plötsligt förs bort en bit av vägen, utan förklaring. "Realistisk vy"
  // (döljer skymda delar helt) finns kvar som en manuell fallback i
  // VisualizationControls.tsx för den som ändå föredrar det.
  const [showHiddenTurbines, setShowHiddenTurbines] = useState(true);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [inApp] = useState(() => (typeof navigator !== "undefined" ? isInAppBrowser() : false));
  const [appName] = useState(() => (typeof navigator !== "undefined" ? inAppBrowserName() : ""));

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const arSceneRef = useRef<ARSceneHandle | null>(null);

  const geo = useGeolocation(started);
  const orientation = useDeviceOrientation(started);
  const camera = useCameraStream(started);

  // Enkel, alltid-synlig diagnostiktext på väntesskärmen (sekunder sedan
  // start + platsbehörighetens status). Kostar inget för vanliga användare,
  // men gör det möjligt för en testare att rapportera exakt vad som händer
  // om något hänger sig igen — istället för bara "det snurrar" — så vi kan
  // slå fast om t.ex. behörigheten fastnat på "prompt" eller om GPS:en
  // verkligen aldrig svarar.
  const [waitSeconds, setWaitSeconds] = useState(0);
  useEffect(() => {
    if (!started) {
      setWaitSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setWaitSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [started]);
  // Manuell nödbroms: en explicit "Fortsätt ändå"-knapp för HELA
  // väntar-overlayen, som blir tillgänglig efter `MANUAL_CONTINUE_ANYWAY_MS`
  // om GPS-fix redan finns men kameran/kompassen ändå inte blivit klara — så
  // en användare aldrig behöver vänta ut appen om den upplevs som "fastnad".
  // Kräver fortfarande att kameraströmmen finns (annars finns inget att visa
  // AR mot), men tvingar igenom kompassfix-kravet (`orientation.hasFix`) om
  // sensorn aldrig ger en fix alls.
  const MANUAL_CONTINUE_ANYWAY_MS = 12_000;
  const [manualContinueAvailable, setManualContinueAvailable] = useState(false);
  const [manualContinue, setManualContinue] = useState(false);
  useEffect(() => {
    if (!started) {
      setManualContinueAvailable(false);
      setManualContinue(false);
      return;
    }
    const id = window.setTimeout(() => setManualContinueAvailable(true), MANUAL_CONTINUE_ANYWAY_MS);
    return () => window.clearTimeout(id);
  }, [started]);

  // PRODUKTKRAV: så fort kamera, GPS och kompass har GRUNDDATA (en fix, inte
  // nödvändigtvis en färdigkalibrerad/"settled" kompass) ska verken visas
  // direkt, mot senaste stabila position — kalibreringen (`hasSettled`) får
  // fortsätta i bakgrunden men får ALDRIG blockera AR-vyn. `hasSettled`
  // krävdes tidigare här, vilket kunde få appen att stå och "tugga" på
  // "Kalibrerar kompass…" i flera sekunder trots att det redan fanns
  // fullt tillräcklig data för att rendera. Positionens/riktningens
  // faktiska STABILITET (frysning vid svag signal, mjuk uttoning) hanteras
  // separat av `useArTrackingStability` nedan — den är oberoende av detta
  // grindvillkor och gäller även efter att `ready` blivit sant.
  const ready =
    started &&
    geo.lat !== null &&
    geo.lon !== null &&
    (orientation.hasFix || manualContinue) &&
    Boolean(camera.stream);

  // Ren informationstext (blockerar INGET) som visas medan kompassen
  // fortfarande kalibrerar sig i bakgrunden efter att `ready` redan blivit
  // sant — så användaren vet att precisionen fortfarande förbättras utan
  // att AR-vyn för den skull döljs eller fördröjs.
  const stillCalibrating = ready && orientation.hasFix && !orientation.hasSettled;
  const wind = useWindSound();
  // Kamerabaserad himmel/inomhus-heuristik (se `useSkyDetection`s jsdoc för
  // begränsningar) — styr både AR-verkens synlighet (via `isPointSky`,
  // skickas till ARScene) och dämpningen av vindljudet/dBA-uppskattningen
  // nedan när användaren bedöms vara inomhus.
  const sky = useSkyDetection(videoElRef, started);

  // "Outdoor Confidence Index" (0-100%): väger samman kamera/AI-himmelsandel,
  // GPS-precision, ljusnivå, kompass-stabilitet, rörelse och wifi-antydan
  // till ett enda index som styr HUR verken visas (normalt/försiktigt/
  // dolt), utöver den redan befintliga per-punkts himmelsmasken ovan.
  const confidence = useOutdoorConfidenceIndex({
    enabled: started,
    cameraSkyRatio: sky.skyRatio,
    gpsAccuracy: geo.accuracy,
    ambientLuminance: sky.avgLuminance,
    headingStabilityRef: orientation.headingStabilityRef,
  });

  // AR-PLACERINGENS stabilitet (produktkrav: kontinuerlig sensorfusion,
  // frysning på svag signal, mjuk uttoning, mjuk korrigering) — smalare och
  // strängare än `confidence` ovan, som styr allmän synlighet/tonläge.
  // Denna styr istället om `smoothedGeo` nedan fryses helt och om verken
  // ska börja tona bort efter långvarigt dåligt läge.
  const arTracking = useArTrackingStability({
    enabled: started,
    gpsAccuracy: geo.accuracy,
    headingStabilityRef: orientation.headingStabilityRef,
    headingAccuracyDegRef: orientation.headingAccuracyDegRef,
    orientationHasFix: orientation.hasFix,
  });

  // Minimikrav enligt produktkrav: minst 15-20% synlig himmel i bild innan
  // verk visas överhuvudtaget, oavsett vad de övriga signalerna i indexet
  // ovan säger — en enstaka ljus yta (t.ex. en vit vägg) ska inte räcka.
  const MIN_SKY_RATIO = 0.15;
  const hasEnoughSky = sky.skyRatio >= MIN_SKY_RATIO;

  // Hela detta index (och "Gå utomhus"/"aim"-bannern nedan) förutsätter att
  // ML-segmenteringen faktiskt är igång och därmed levererar en tillförlitlig
  // himmelsandel. Om den fortfarande laddas eller är permanent avstängd
  // gäller samma fallback-krav som för den per-punkts ocklusionen i
  // `useSkyDetection`: verken förblir alltid fullt synliga och ingen
  // "Gå utomhus"/aim-overlay visas — vi låter aldrig ett index som bygger på
  // en inaktiv signal dölja verk.
  const mlActive = sky.method === "ml";

  // Global synlighetsstyrka som skickas till ARScene: 1 = visa normalt,
  // 0.6 = "cautious"-tonat, 0 = dölj helt ("aim"/"hide", eller otillräcklig
  // himmelsandel). `sky.ready` väntar in det allra första samplet så verken
  // inte blixtrar till fullt synliga under den första bildrutan.
  const globalVisibilityFactor =
    (!mlActive
      ? 1
      : !sky.ready || !hasEnoughSky
        ? 0
        : confidence.tier === "show"
          ? 1
          : confidence.tier === "cautious"
            ? 0.6
            : 0) * arTracking.fadeFactor;

  // ---- Verklig inomhus-/fri sikt-bedömning ----
  // Till skillnad från `mlActive`-indexet ovan (permanent avstängt, se
  // `sky.method`s jsdoc — dess "hide"/"aim"-nivåer kan därför ALDRIG slå
  // till) bygger detta direkt på `sky.indoors`: den riktiga, hysteresbaserade
  // bedömningen från den lätta kamera-heuristiken (ljusstyrka/textur/
  // mättnad) som alltid kör, oavsett ML-status. Styr både den stora
  // inomhus-overlayen nedan och (via `hideAll` till ARScene) ett explicit
  // skyddsnät utöver den befintliga per-pixel-ocklusionen, så verk aldrig
  // kan synas som om de vore fritt synliga genom en vägg/tak.
  //
  // VIKTIGT: kräver `ready` (dvs. GPS + kompass + kamera har ALLA redan fått
  // en fix) av samma anledning den gamla `shouldHide` gjorde: overlayen får
  // aldrig täcka "Hämtar GPS-position…"-spinnern eller ett GPS-felmeddelande
  // bara för att kameran råkar peka mot ett bord/en vägg under uppstarten.
  const indoorsOrNoSight = ready && sky.ready && sky.indoors;

  // Liten alltid-synlig statusbadge: "Fri sikt" / "Delvis skymt" / "Ingen
  // fri sikt" — samma underliggande `sky.indoors`/`sky.skyRatio`, men med en
  // mjukare mellanläge (skymd av t.ex. några träd, men inte "inomhus") så
  // signalen inte bara är på/av.
  const PARTIAL_SKY_RATIO_THRESHOLD = 0.6;
  const lineOfSightStatus: "clear" | "partial" | "indoors" = !sky.ready
    ? "clear"
    : sky.indoors
      ? "indoors"
      : sky.skyRatio < PARTIAL_SKY_RATIO_THRESHOLD
        ? "partial"
        : "clear";

  // Om Permissions API redan känner till att platsbehörigheten är nekad
  // (t.ex. från ett tidigare besök) visar vi det direkt på startskärmen,
  // innan användaren ens tryckt "Starta visualisering" — annars ser de bara
  // en förvirrande evig snurra efter att ha tryckt, utan att förstå varför.
  const preStartPermissionError =
    !started && geo.permissionState === "denied"
      ? "Platsbehörighet nekad. Tillåt Plats för den här sidan i webbläsarens inställningar och ladda om sidan innan du startar."
      : null;

  const errors = useMemo(
    () =>
      [preStartPermissionError, geo.error, orientation.error, camera.error].filter((e): e is string => Boolean(e)),
    [preStartPermissionError, geo.error, orientation.error, camera.error],
  );

  // Stabiliserad GPS-position: ignorerar små GPS-studs (<15 m) så att
  // dBA-uppskattningen nedan inte omberäknas för varje litet, naturligt
  // GPS-brus medan användaren i praktiken står still.
  const stableGeo = useStableGeoPosition(geo.lat, geo.lon);

  // Utjämnad GPS-position (kontinuerligt EMA-filter, ~1.2s tidskonstant) för
  // AR-verkens faktiska placering — till skillnad från `stableGeo` ovan
  // (som fryser positionen i stora 15m-hopp, olämpligt för visuell
  // placering) svarar den här mjukt på verklig rörelse men filtrerar bort
  // det meterskaliga GPS-bruset som annars fick verken att "fladdra" i
  // AR-vyn även när användaren stod still.
  const smoothedGeo = useSmoothedGeoPosition(geo.lat, geo.lon, geo.accuracy, arTracking.freeze);

  // Avstånd (stabiliserad GPS) till samtliga verk — delas av båda
  // uppskattningarna nedan.
  const turbineDistancesM = useMemo(() => {
    if (stableGeo.lat === null || stableGeo.lon === null) return null;
    return activeTurbines.map((t) => {
      const { lat, lon } = swerefToWgs84(t.easting, t.northing);
      return distanceMeters(stableGeo.lat as number, stableGeo.lon as number, lat, lon);
    });
  }, [activeTurbines, stableGeo.lat, stableGeo.lon]);

  // Grov (avstånds-/synlighetsbaserad, ej FOV-/ocklusionsmedveten) räkning
  // av "synliga" verk för sensordebug-panelen — exakt FOV/per-pixel-
  // ocklusion beräknas redan inne i `ARScene.tsx`s render-loop och är inte
  // värt att duplicera här bara för ett diagnostiskt tal.
  const visibleTurbineCount = useMemo(() => {
    if (!turbineDistancesM) return 0;
    if (globalVisibilityFactor <= 0.05 || indoorsOrNoSight) return 0;
    return turbineDistancesM.filter((d) => d <= MAX_RENDER_DISTANCE_M).length;
  }, [turbineDistancesM, globalVisibilityFactor, indoorsOrNoSight]);

  // Anledningar till att verk kan vara dolda just nu, för sensordebug-
  // panelen — samlar ihop de olika (annars separata) döljningsmekanismerna
  // i ett läsbart facit.
  const debugHideReasons = useMemo(() => {
    const reasons: string[] = [];
    if (indoorsOrNoSight) reasons.push("Inomhus/ingen fri sikt (kamera-heuristik)");
    if (mlActive && !hasEnoughSky) reasons.push("För lite synlig himmel i bild");
    if (mlActive && confidence.tier === "hide") reasons.push('Outdoor Confidence Index: "hide"');
    if (mlActive && confidence.tier === "aim") reasons.push('Outdoor Confidence Index: "aim" (rikta mot himlen)');
    if (arTracking.freeze) reasons.push(WEAK_SIGNAL_MESSAGE);
    if (arTracking.fadeFactor < 1) reasons.push("Tonas ut — spårning saknad för länge");
    return reasons;
  }, [indoorsOrNoSight, mlActive, hasEnoughSky, confidence.tier, arTracking.freeze, arTracking.fadeFactor]);

  // Alltid beräknad med full "ute"-nivå (confidence=1) — den manuella
  // ute/inne-dämpningen appliceras separat, EFTER GPS-jitterutjämningen
  // nedan (`applyIndoorAttenuation`), istället för att vara en del av det
  // som utjämnas. Annars dröjde det upp till hela utjämningsfönstret
  // (flera sekunder) innan en växling av "Ljud ute"/"Ljud inne" faktiskt
  // hördes i det spelade vindljudet — bara panelens text uppdaterades
  // direkt. Se `applyIndoorAttenuation`s jsdoc.
  const rawOutdoorEstimate = useMemo(() => {
    if (!turbineDistancesM) return { totalDba: -Infinity, nearestDistanceM: null, contributingCount: 0 };
    return estimateSoundLevel(turbineDistancesM, 1);
  }, [turbineDistancesM]);

  // Glidande medelvärde (5-10s) av den råa UTOMHUS-nivån ovan, uppdaterat
  // högst en gång per sekund — filtrerar bara GPS-brus, inte den manuella
  // väljaren (se ovan).
  const smoothedOutdoorDba = useSmoothedDba(rawOutdoorEstimate.totalDba);

  // Antal bidragande verk räknas om direkt (icke-utjämnat) från den
  // manuella väljaren, så badgen/panelen och den faktiska ljudvolymen
  // alltid reagerar lika omedelbart på en växling.
  const indoorAdjustedEstimate = useMemo(() => {
    if (!turbineDistancesM) return { totalDba: -Infinity, nearestDistanceM: null, contributingCount: 0 };
    return estimateSoundLevel(turbineDistancesM, soundEnvironment === "ute" ? 1 : 0);
  }, [turbineDistancesM, soundEnvironment]);

  const soundLevelEstimate = useMemo(
    () => ({
      totalDba: applyIndoorAttenuation(smoothedOutdoorDba, soundEnvironment === "inne"),
      nearestDistanceM: rawOutdoorEstimate.nearestDistanceM,
      contributingCount: indoorAdjustedEstimate.contributingCount,
    }),
    [smoothedOutdoorDba, soundEnvironment, rawOutdoorEstimate.nearestDistanceM, indoorAdjustedEstimate.contributingCount],
  );

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

  // Närmaste verk (raw GPS, ej stabiliserad/utjämnad — samma precision som
  // infraljudmonitorn tidigare räknade fram inline) — delas nu av både den
  // monitorn och den nya "peka mot närmaste verk"-pilen, så de aldrig kan
  // råka peka/räkna mot olika verk.
  const nearestTurbineInfo = useMemo(() => {
    if (geo.lat === null || geo.lon === null) return null;
    const lat0 = geo.lat;
    const lon0 = geo.lon;
    return activeTurbines.reduce<{ distanceM: number; bearingDeg: number } | null>((closest, t) => {
      const { lat, lon } = swerefToWgs84(t.easting, t.northing);
      const distanceM = distanceMeters(lat0, lon0, lat, lon);
      if (!closest || distanceM < closest.distanceM) {
        return { distanceM, bearingDeg: bearingDegrees(lat0, lon0, lat, lon) };
      }
      return closest;
    }, null);
  }, [activeTurbines, geo.lat, geo.lon]);

  const noiseImpact = useMemo(() => {
    const exposureSeconds =
      exposureStartRef.current !== null ? (exposureNowTick - exposureStartRef.current) / 1000 : 0;

    return estimateNoiseImpact({
      estimate: soundLevelEstimate,
      bearingToNearestDeg: nearestTurbineInfo?.bearingDeg ?? null,
      windFromDeg: windDirection.windFromDeg,
      windSpeedMs: windDirection.windSpeedMs,
      exposureSeconds,
    });
  }, [nearestTurbineInfo, soundLevelEstimate, windDirection.windFromDeg, windDirection.windSpeedMs, exposureNowTick]);

  // Uppdatera vindljudets volym/svischtakt när GPS-position eller den
  // beräknade ljudnivån ändras. Utomhusgainen räknas fram från den
  // icke-dämpade `smoothedOutdoorDba` (exakt samma tal som ligger bakom
  // panelens "ute"-siffra), och "Ljud inne" appliceras sedan som en direkt,
  // garanterad multiplikator (`applyIndoorGain`) på den REDAN beräknade
  // gainen — INTE genom att köra en redan -35 dB-dämpad dBA-siffra genom
  // `dbaToGain`s golv/tak-klippning igen. Se `applyIndoorGain`s jsdoc: det
  // gamla sättet klippte "Ljud inne"-volymen till exakt 0 för i praktiken
  // alla realistiska utomhusnivåer, så om utomhusnivån redan låg nära
  // `dbaToGain`s golv (vanligt på riktiga GPS-avstånd i Katrineholm) gav
  // växlingen ingen hörbar skillnad alls — den rapporterade buggen.
  const windDbaGain = useMemo(
    () => applyIndoorGain(dbaToGain(smoothedOutdoorDba), soundEnvironment === "inne"),
    [smoothedOutdoorDba, soundEnvironment],
  );
  useEffect(() => {
    if (!wind.playing) return;
    wind.updateProximity(windDbaGain, AVG_RPM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wind.playing, windDbaGain]);

  const handleStart = useCallback(() => {
    setStarting(true);
    setShowLoadingSequence(true);
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
    //
    // OBS enableHighAccuracy: false här (medvetet, till skillnad från den
    // riktiga watchPosition-bevakningen i useGeolocation): den här anropet
    // kastas bort — vi bryr oss bara om att trigga behörighetsdialogen. Om
    // vi begär hög noggrannhet (GPS-chip) HÄR *samtidigt* som den riktiga
    // watchPosition-bevakningen startar en bråkdel av en sekund senare, kan
    // de två samtidiga GPS-chip-förfrågningarna konkurrera om samma
    // hårdvara på många Android-enheter och avsevärt fördröja/blockera den
    // riktiga positionsfixen — exakt det som såg ut som "GPS hänger sig".
    // Med enableHighAccuracy: false används bara nätverks-/wifi-baserad
    // positionering för detta bortkastade anrop, vilket inte konkurrerar om
    // GPS-chipet.
    navigator.geolocation?.getCurrentPosition(
      () => {},
      () => {},
      { enableHighAccuracy: false, timeout: 15000, maximumAge: Infinity },
    );
    navigator.mediaDevices
      ?.getUserMedia?.({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => {});

    const finish = () => {
      // Nollställ/starta åtta-rörelsens sektorspårning precis när AR-flödet
      // startar, så att `LoadingSequence`s kompass-steg (se nedan) kan visa
      // ett levande kalibreringsförlopp istället för en blind timer.
      orientation.startCalibrationTracking();
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

  // VIKTIGT: måste ha stabil identitet. `LoadingSequence`s checklista
  // beror på denna callback i sitt completion-effekt — om vi (som tidigare)
  // skickar en ny inline-funktion vid varje render här (Home.tsx
  // renderas om flera gånger per sekund p.g.a. GPS/kompass/himmel-
  // detektering), nollställs den effektens 500ms-timer om och om igen så
  // den ALDRIG hinner köra. Det gav exakt buggen där checklistan visuellt
  // blir klar ("Startar AR…") men appen fastnar där för evigt.
  const handleLoadingSequenceComplete = useCallback(() => setShowLoadingSequence(false), []);

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

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#090909] text-white">
      {!started && (
        <PermissionGate
          onStart={handleStart}
          onOpenMapTool={() => navigate("/placera")}
          starting={starting}
          errors={errors}
          turbineCount={activeTurbines.length}
        />
      )}

      {started && (
        <>
          {showLoadingSequence && (
            <LoadingSequence
              onComplete={handleLoadingSequenceComplete}
              calibrationPhase={orientation.calibrationPhase}
              calibrationProgress={orientation.calibrationProgress}
              skipCalibration={!orientation.supported || Boolean(orientation.error)}
            />
          )}

          <CameraBackground stream={camera.stream} videoRef={videoElRef} />

          {ready && (
            <ARScene
              ref={arSceneRef}
              userLat={smoothedGeo.lat ?? geo.lat!}
              userLon={smoothedGeo.lon ?? geo.lon!}
              quaternionRef={orientation.quaternionRef}
              turbines={activeTurbines}
              sunMode={sunMode}
              realScale={realScale}
              visibility={visibility}
              nightMode={nightMode}
              shadowFlicker={shadowFlicker}
              isPointSky={sky.isPointSky}
              getOcclusionGrid={sky.getOcclusionGrid}
              showHiddenTurbines={showHiddenTurbines}
              globalVisibilityFactor={globalVisibilityFactor}
              hideAll={indoorsOrNoSight}
            />
          )}

          {ready && (
            <NearestTurbineArrow
              headingDegRef={orientation.headingDegRef}
              bearingDeg={nearestTurbineInfo?.bearingDeg ?? null}
              distanceM={nearestTurbineInfo?.distanceM ?? null}
              indoors={indoorsOrNoSight}
            />
          )}

          {/* Dagsläge stänger av mörkläggningen helt, oavsett vilket
              visualiseringsläge (t.ex. "Kväll") som är valt — bara det
              manuella Nattläge-valet styr detta filter. */}
          {ready && nightMode && (
            <div className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-b from-[#0a1030]/55 via-[#0a1030]/35 to-[#0a1030]/60" />
          )}

          {!ready && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 px-8 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF8B01] border-t-transparent" />
              <p className="text-sm text-white/90">
                {!camera.stream && "Startar kameran…"}
                {camera.stream && geo.lat === null && "Väntar på GPS-signal…"}
                {camera.stream && geo.lat !== null && !orientation.hasFix && "Kompassen behöver kalibreras."}
              </p>

              {/* Statuspanel: visar GPS/kompass/kamera/AR-status var för sig
                  så en användare (eller testare) alltid ser EXAKT vad som
                  saknas, istället för att bara gissa utifrån en enda
                  textrad. */}
              <ul className="w-full max-w-xs space-y-1 rounded-xl bg-black/30 p-3 text-left text-[11px] text-white/70">
                <li className="flex items-center justify-between">
                  <span>📷 Kamera</span>
                  <span>{camera.stream ? "✅ Redo" : camera.error ? "❌ Fel" : "⏳ Startar…"}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>📍 GPS</span>
                  <span>{geo.lat !== null ? "✅ Fix" : geo.error ? "❌ Fel" : "⏳ Söker…"}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>🧭 Kompass</span>
                  <span>
                    {orientation.hasFix
                      ? orientation.hasSettled
                        ? "✅ Stabil"
                        : "✅ Hittad"
                      : orientation.error
                        ? "❌ Fel"
                        : "⏳ Söker…"}
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span>🌬️ AR-scen</span>
                  <span>{ready ? "✅ Redo" : "⏳ Väntar"}</span>
                </li>
              </ul>

              {/* Åtgärdsknappar för de vanligaste "fastnat"-lägena: låter
                  användaren själv trigga om en ny GPS-fix eller starta om
                  kompassens riktningskalibrering, istället för att bara
                  kunna vänta eller ladda om hela sidan. Alltid synliga
                  (oberoende av kamerastatus) — GPS/kompass kan behöva
                  återstartas även om kameran inte har startat ännu. */}
              <div className="flex w-full max-w-xs flex-wrap justify-center gap-2">
                <button
                  onClick={() => {
                    orientation.startCalibrationTracking();
                    orientation.calibrateHorizon();
                  }}
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/80 hover:bg-white/10"
                >
                  🧭 Kalibrera om riktning
                </button>
                <button
                  onClick={geo.retry}
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/80 hover:bg-white/10"
                >
                  📍 Uppdatera position
                </button>
              </div>

              {manualContinueAvailable && !manualContinue && camera.stream && geo.lat !== null && (
                <button
                  onClick={() => setManualContinue(true)}
                  className="rounded-full bg-[#FF8B01] px-4 py-2 text-xs font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/20 transition hover:bg-[#FFB347]"
                >
                  Fortsätt ändå →
                </button>
              )}
              {/* Samma hjälptexter som produktkravet specificerar för de två
                  vanligaste fastnandena, så användaren aldrig bara ser en
                  snurrande spinner utan förklaring. */}
              {camera.stream && geo.lat === null && (
                <p className="text-xs text-white/50">Gå gärna ut på en öppen plats och rikta telefonen mot himlen.</p>
              )}
              {camera.stream && geo.lat !== null && !orientation.hasFix && (
                <p className="text-xs text-white/50">Vrid telefonen enligt instruktionen ovan (liggande, sedan stående).</p>
              )}
              {camera.stream && geo.lat === null && !geo.error && (
                <p className="text-[11px] text-white/40">
                  {waitSeconds}s — platsbehörighet:{" "}
                  {geo.permissionState === "granted"
                    ? "beviljad"
                    : geo.permissionState === "denied"
                      ? "nekad"
                      : geo.permissionState === "prompt"
                        ? "väntar på svar"
                        : "okänd"}
                </p>
              )}
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
                  {camera.error && (
                    <button
                      onClick={camera.retry}
                      className="w-full rounded-full bg-[#FF8B01] py-2.5 text-xs font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/20 transition hover:bg-[#FFB347]"
                    >
                      🔄 Försök igen med kameran
                    </button>
                  )}
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

          {/* Inomhus-/fri sikt-overlay: visas bara EFTER att `ready` är sant
              (dvs. GPS/kompass/kamera har redan fått fix) — se
              `indoorsOrNoSight`s jsdoc ovan för varför. Turbinerna är redan
              garanterat osynliga (se `hideAll` till ARScene ovan), så detta
              ger en tydlig, stor förklaring istället för en till synes tom/
              livlös vy — och gör explicit att ljudet fortfarande fungerar.
              Ligger på ett högre z-index än både topp- och bottenraden
              (z-20) så att meddelandet ALDRIG hamnar bakom knappar/paneler. */}
          {started && indoorsOrNoSight && (
            <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/85 px-8 text-center">
              <span className="animate-pulse text-6xl">🏠➡️🌤️</span>
              <p className="text-xl font-bold text-white">
                Du verkar vara inomhus eller saknar fri sikt mot vindkraftverken
              </p>
              <p className="max-w-xs text-sm text-white/80">
                Vindljudet visas fortfarande baserat på din position. Flytta dig till ett fönster eller gå
                utomhus för att se dem i AR.
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

          {ready && stillCalibrating && (
            <div className="pointer-events-none absolute inset-x-0 top-32 z-30 flex justify-center px-6">
              <span className="max-w-xs rounded-full bg-yellow-500/90 px-4 py-1.5 text-center text-xs font-medium text-[#090909] shadow-lg">
                Kalibrerar kompass i bakgrunden – fortsätt röra telefonen långsamt för bättre precision.
              </span>
            </div>
          )}

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 z-20 flex flex-col gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#FFB347]">VINDKRAFT AR</p>
                <p className="text-sm text-white/90">
                  Katrineholm · {activeTurbines.length} verk{usingCustomPlacement && " · din placering"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <LineOfSightStatus status={lineOfSightStatus} />
                <SoundLevelBadge estimate={soundLevelEstimate} indoors={soundEnvironment === "inne"} />
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
            {ready && arTracking.weakSignalMessage && (
              <div className="flex justify-center">
                <span className="max-w-xs rounded-full bg-yellow-500/90 px-4 py-1.5 text-center text-xs font-medium text-[#090909] shadow-lg">
                  ⚠️ {arTracking.weakSignalMessage}
                </span>
              </div>
            )}
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
              {/* Explicit, alltid synlig ute/inne-väljare för ljudet — ersätter
                  det gamla automatiska (kamerastyrda) beteendet. Startar alltid
                  på "Ljud ute" enligt produktkravet, se `soundEnvironment`s
                  useState ovan. */}
              <button
                onClick={() => setSoundEnvironment((v) => (v === "ute" ? "inne" : "ute"))}
                aria-pressed={soundEnvironment === "inne"}
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 aria-pressed:bg-[#FF8B01]/25 aria-pressed:text-[#FFB347]"
              >
                {soundEnvironment === "ute" ? "🔊 Ljud ute" : "🔈 Ljud inne"}
              </button>
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
                indoors={soundEnvironment === "inne"}
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
            <button
              onClick={() => navigate("/placera")}
              className="w-full rounded-full border border-[#FF8B01]/40 bg-[#FF8B01]/10 py-3 text-sm font-semibold text-[#FFB347] hover:bg-[#FF8B01]/20"
            >
              🗺️ Placera vindkraftverken själv
            </button>
            {usingCustomPlacement && (
              <button
                onClick={handleClearCustomPlacement}
                className="w-full rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white/80 hover:bg-white/10"
              >
                ↩️ Återgå till planerad placering (29 verk)
              </button>
            )}
          </div>
        </>
      )}

      {showMap && (
        <MapView turbines={activeTurbines} userLat={geo.lat} userLon={geo.lon} onClose={() => setShowMap(false)} />
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
          showHiddenTurbines={showHiddenTurbines}
          onToggleShowHiddenTurbines={() => setShowHiddenTurbines((v) => !v)}
          showSensorDebug={showSensorDebug}
          onToggleSensorDebug={() => setShowSensorDebug((v) => !v)}
          onClose={() => setShowControls(false)}
        />
      )}
      {showSensorDebug && (
        <SensorDebugPanel
          gpsAccuracyM={geo.accuracy}
          headingDeg={orientation.headingDegRef.current}
          headingStability={orientation.headingStabilityRef.current}
          headingAccuracyDeg={orientation.headingAccuracyDegRef.current}
          pitchDeg={orientation.pitchDegRef.current}
          horizonOffsetDeg={orientation.horizonOffsetDegRef.current}
          arTrackingTier={arTracking.tier}
          frozenForMs={arTracking.debug.frozenForMs}
          visibleTurbineCount={visibleTurbineCount}
          totalTurbineCount={activeTurbines.length}
          hideReasons={debugHideReasons}
          onClose={() => setShowSensorDebug(false)}
        />
      )}
    </div>
  );
}
