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
import { CompassStabilityBadge } from "@/components/CompassStabilityBadge";
import { GpsQualityBadge } from "@/components/GpsQualityBadge";
import { ArStabilityBadge } from "@/components/ArStabilityBadge";
import { NearestTurbineArrow } from "@/components/NearestTurbineArrow";
import { LiveDebugStrip } from "@/components/LiveDebugStrip";
import { PhotoMontageModal } from "@/components/PhotoMontageModal";
import { InAppBrowserNotice } from "@/components/InAppBrowserNotice";
import { inAppBrowserName, isInAppBrowser } from "@/lib/browserDetection";
import { TURBINES, type TurbineSweref } from "@/lib/turbines";
import { distanceMeters, bearingDegrees, isNightTime, normalizeAngle, formatDistance } from "@/lib/geo";
import { swerefToWgs84, wgs84ToSweref } from "@/lib/sweref";
import { getBladeRpm } from "@/lib/turbineAnimation";
import { estimateSoundLevel, dbaToVolume, applyIndoorAttenuation, applyIndoorGain } from "@/lib/soundLevel";
import { estimateNoiseImpact } from "@/lib/noiseImpact";
import { useWindDirection } from "@/hooks/useWindDirection";
import type { SunMode, VisibilityLevel } from "@/lib/visualizationTypes";
import { KATRINEHOLM_CENTER } from "@/lib/ericsbergArea";
import {
  captureNativeCameraPhoto,
  isNative,
  openSverigekartan,
  requestAllPermissionsSequentially,
} from "@/lib/capacitorBridge";
import { NativeDiagnostics } from "@/components/NativeDiagnostics";

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
  // Juli 2026-fix (kritisk buggrapport punkt 2, "explicit debug logging för
  // varje pipeline-steg"): "Loaded N turbines" loggas EN gång per faktisk
  // ändring av datakällan (standard- eller anpassad placering), inte varje
  // rendering — annars svämmar konsolen över utan att tillföra något.
  useEffect(() => {
    console.info(`[AR][pipeline] Loaded ${activeTurbines.length} turbines`);
  }, [activeTurbines]);
  const handleClearCustomPlacement = useCallback(() => {
    localStorage.removeItem(AR_HANDOFF_KEY);
    setCustomTurbines(null);
  }, []);

  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  // Fel från sekventiell native behörighetsförfrågan — visas i PermissionGate.
  const [nativePermError, setNativePermError] = useState<string | null>(null);
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
  // Juli 2026-fix ("AR-vyn känns rörig, knappar överlappar"): "Visa karta",
  // "Om projektet", "Placera vindkraftverken själv" och
  // återgå-till-planerad-placering var alla ALLTID synliga knappar staplade
  // i botten-baren, ovanpå ljudpanelen och petitions-CTA:n — trängde ihop
  // sig med kompass/GPS/AR-stabilitet-badgarna och pilen mot närmaste verk.
  // De är sekundära (används sällan mitt i AR-sessionen) och samlas nu bakom
  // en enda "☰ Meny"-knapp, medan de primära knapparna (petition, foto)
  // förblir direkt synliga.
  const [showMenu, setShowMenu] = useState(false);
  const [showControls, setShowControls] = useState(false);
  // Juli 2026-fix (kritisk buggrapport punkt 5: "felsökningsraden överlappar
  // loggan/statustexten i topp-baren"): `LiveDebugStrip` låg tidigare fast på
  // `top-0` (z-[60]) rakt ovanpå topp-baren (z-[45]), som själv har en
  // variabel, innehållsberoende höjd (badge-rad + knapp-rad, olika antal
  // rader beroende på skärmbredd/aktiva lägen). Ett gissat fast pixelvärde
  // skulle bara flytta problemet till en annan skärmstorlek/tillstånd. Mäter
  // istället topp-barens FAKTISKA renderade höjd via `ResizeObserver` och
  // placerar felsökningsraden precis under den — garanterat överlappsfritt
  // oavsett hur många badges/rader som visas.
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const [topBarHeight, setTopBarHeight] = useState(0);
  // Juli 2026-fix (produktfeedback, ny omgång: "flytta den gröna texten
  // högst upp och flytta ner allt annat lite"): omvänd riktning mot fixen
  // ovan — `LiveDebugStrip` ligger nu fast överst, och topp-baren (samt
  // statusbannern nedanför) skjuts i stället ner med den HÄR mätta höjden
  // (remsans eget innehåll, se `debugStripHeightEffect` nedan) så de aldrig
  // hamnar bakom/överlappar varandra, oavsett hur bred skärmen är (remsan
  // radbryts på smala skärmar och blir därmed högre).
  const debugStripRef = useRef<HTMLDivElement | null>(null);
  const [debugStripHeight, setDebugStripHeight] = useState(0);
  const [showSensorDebug, setShowSensorDebug] = useState(false);
  // Juli 2026-fix (produktfeedback, ny omgång: "gör informationen smartare
  // så den inte tar upp lika mycket plats och inte skymmer varandra"):
  // föregående fix bytte badge-raden till `flex-wrap` för att lösa den
  // avklippta badgen, men det gjorde topp-baren MYCKET högre (upp till 4
  // rader: titel, GPS/Kompass, AR-stabilitet/Fri sikt, dBA/Infraljud) —
  // vilket i sin tur exponerade en separat, redan existerande bugg: den
  // fasta, gissade `top-32`/`top-[7.5rem]` på statusbannern/felbannern
  // hann inte alls med topp-barens nya, dynamiska höjd och hamnade mitt i
  // knapparna. `showStatusDetails` döljer nu de FYRA minst akuta
  // statusbadgarna (AR-stabilitet%, Fri sikt, dBA, Infraljud) bakom en
  // liten "▾ Mer status"-knapp, default hopfälld — bara GPS/Kompass (de
  // två som redan visats vara mest efterfrågade, se `CompassStabilityBadge`
  // platsflytt ovan) syns per default. Se även `topBarRef`s stil nedan
  // (statusbanner/felbanner beräknar nu sin position FRÅN topp-barens
  // faktiska mätta höjd istället för en gissning).
  const [showStatusDetails, setShowStatusDetails] = useState(false);
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
  // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 1 & 3): rena
  // felsökningslägen, PÅ-slagna via `SensorDebugPanel` nedan — påverkar
  // ARScene direkt (se dess jsdoc), aldrig produktinställningarna ovan.
  const [debugForceNearest, setDebugForceNearest] = useState(false);
  const [debugDisableOcclusion, setDebugDisableOcclusion] = useState(false);
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
  // PRODUKTKRAV (juli 2026, "Render first – refine continuously"): så fort
  // kamera och GPS finns tillgängliga ska verken visas DIREKT — kompassens
  // riktning (`orientation.hasFix`/`hasSettled`) får ALDRIG blockera detta,
  // varken den första grovfixen eller den efterföljande kalibreringen.
  // Innan kompassen hunnit leverera en första avläsning används helt enkelt
  // `quaternionRef`s identitets-startvärde (rakt fram) som en rimlig första
  // gissning; så fort första sensoravläsningen kommer (typiskt inom några
  // hundra ms) och sedan varje efterföljande avläsning roteras kameran om
  // kontinuerligt i `ARScene`s animate-loop (30-60 ggr/s, styrt av enhetens
  // faktiska sensorfrekvens) — verken "glider" alltså mjukt till sin exakta
  // riktning istället för att användaren står och väntar på att de "dyker
  // upp". Detta ersätter den tidigare `orientation.hasFix`-spärren (och den
  // nödbroms-knapp den krävde) helt.
  // cameraActive: true om kameran är igång — antingen via getUserMedia (webb)
  // eller via native CameraPreview-plugin (iOS/Android).
  const cameraActive = Boolean(camera.stream) || camera.nativePreview;
  const ready = started && geo.lat !== null && geo.lon !== null && cameraActive;

  // Juli 2026-fix (fjärde kritiska buggrapporten, punkt "UI-fix"): denna
  // effekt (som mäter topp-barens FAKTISKA höjd, se `topBarRef`s kommentar
  // ovan) berodde tidigare på `[started]`, men `topBarRef`s `<div>` renderas
  // villkorat på `ready` (`arSessionVisible` nedan är bara ett alias för
  // `ready`) — vilket ALLTID blir sant EFTER `started` (GPS/kompass/kamera-
  // fix tar sekunder). Effekten kördes alltså EN gång vid `started`, hittade
  // `topBarRef.current === null` (elementet fanns ännu inte i DOM:en), satte
  // `topBarHeight` till 0 och returnerade utan att sätta upp någon
  // `ResizeObserver` alls — och kördes sedan ALDRIG om, eftersom `started`
  // inte ändras igen. Resultatet blev att `LiveDebugStrip` permanent trodde
  // topp-baren hade höjd 0 och därför alltid ritades på `top: 0`, rakt ovanpå
  // "Katrineholm · N verk". Fixat genom att bero på `ready` istället — samma
  // flagga som faktiskt styr om `topBarRef`s `<div>` finns i DOM:en eller ej
  // (effekten flyttad hit, efter `ready`s deklaration, för att undvika en
  // "used before declaration"-TDZ-fel).
  useEffect(() => {
    const el = topBarRef.current;
    if (!el) {
      setTopBarHeight(0);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setTopBarHeight(entry.contentRect.height);
    });
    observer.observe(el);
    setTopBarHeight(el.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [ready]);

  // Ren informationstext (blockerar INGET) som visas medan kompassen
  // fortfarande kalibrerar sig i bakgrunden efter att `ready` redan blivit
  // sant — så användaren vet att precisionen fortfarande förbättras utan
  // att AR-vyn för den skull döljs eller fördröjs.
  const stillCalibrating = ready && orientation.hasFix && !orientation.hasSettled;

  // Juli 2026-fix (regressionsrapport: "renderingen väntar på kalibrering"):
  // `arSessionVisible` STYRDE TIDIGARE av `ready && !showLoadingSequence` —
  // dvs. hela AR-sessionen (kamerabakgrund, turbin-overlay, HUD, pilen)
  // förblev osynlig tills `LoadingSequence`s EGEN tidslinje (kalibrering →
  // nedräkning → checklista) helt stängts, oavsett att `ARScene`s
  // requestAnimationFrame-loop redan renderade och positionerade alla verk
  // korrekt under tiden. I dåliga magnetfält kunde kalibreringssteget ta upp
  // till ~18s PER delsteg (se `LoadingSequence.tsx`), vilket upplevdes precis
  // som produktkravet varnar för: "inga verk visas, pilen reagerar inte" —
  // fast rendering/positionering i själva verket kördes hela tiden bakom en
  // overlay. `arSessionVisible` beror nu ENDAST på `ready` (GPS+kompass+
  // kamera-fix) — ALDRIG på om laddningssekvensen visuellt hunnit stängas.
  // `LoadingSequence` har istället fått ett högre z-index än alla HUD-
  // element (se dess egen kommentar) så den ändå visuellt täcker/döljer
  // HUD:en snyggt utan att blöda igenom, precis som den ursprungliga fixen
  // avsåg — men utan att BLOCKERA den underliggande renderingen.
  const arSessionVisible = ready;

  // Juli 2026-fix (produktfeedback, ny omgång): samma mönster som
  // topp-barens höjd-effekt ovan (samma TDZ-/monteringsordning-fälla —
  // `debugStripRef`s `<div>` renderas villkorat på `arSessionVisible`, inte
  // `started`, därför placerad HÄR efter `arSessionVisible`s deklaration),
  // men mäter i stället `LiveDebugStrip`s EGNA renderade höjd, för att
  // skjuta ner topp-baren/statusbannern med rätt mellanrum.
  useEffect(() => {
    const el = debugStripRef.current;
    if (!el) {
      setDebugStripHeight(0);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setDebugStripHeight(entry.contentRect.height);
    });
    observer.observe(el);
    setDebugStripHeight(el.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [arSessionVisible]);

  // Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 1/2): tidsstämpeln
  // för när AR-sessionen FÖRST blev synlig — skickas till `ARScene` som
  // `arStartedAtMs` och styr dess 5-sekunders "Direkt AR" → "World locked"-
  // övertoning (se `WORLD_LOCK_BLEND_MS` i `ARScene.tsx`). Sätts EN gång per
  // session (inte om vid varje omrendering) och nollställs så fort sessionen
  // slutar vara synlig, så en ny AR-start (t.ex. efter att appen minimerats)
  // alltid får en ny, egen "Direkt AR"-period istället för att ärva den
  // gamla övertoningens redan förflutna tid.
  const [arStartedAtMs, setArStartedAtMs] = useState<number | null>(null);
  useEffect(() => {
    if (arSessionVisible) {
      setArStartedAtMs((prev) => prev ?? Date.now());
    } else {
      setArStartedAtMs(null);
    }
  }, [arSessionVisible]);

  // Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 3): "Visa/dölj
  // verk"-togglen — påverkar ENDAST turbinernas synlighet (0.5s
  // in-/uttoning, se `TURBINES_VISIBLE_FADE_MS` i `ARScene.tsx`), aldrig
  // resten av AR-vyn (kamera, HUD, pilen). Default synlig enligt
  // produktkravet.
  const [turbinesVisible, setTurbinesVisible] = useState(true);

  // Juli 2026-fix (kritisk buggrapport punkt 2): explicita, engångsloggade
  // brödsmulor för de tidiga pipeline-stegen ("GPS OK", "Compass OK",
  // "Visible=true") — tidigare fanns ENDAST visuell felsökningstext i
  // gränssnittet (t.ex. `LiveDebugStrip`/`SensorDebugPanel`), ingenting i
  // webbläsarkonsolen, vilket gjorde det svårt för en testare att skicka en
  // exakt reproducerbar felrapport. `useRef`-flaggorna säkerställer att
  // varje rad bara loggas EN gång per AR-session, inte varje omrendering.
  const loggedGpsOkRef = useRef(false);
  const loggedCompassOkRef = useRef(false);
  const loggedVisibleRef = useRef(false);
  useEffect(() => {
    if (!started) {
      loggedGpsOkRef.current = false;
      loggedCompassOkRef.current = false;
      loggedVisibleRef.current = false;
    }
  }, [started]);
  useEffect(() => {
    if (geo.lat !== null && geo.lon !== null && !loggedGpsOkRef.current) {
      loggedGpsOkRef.current = true;
      // Juli 2026-fix (kritisk buggrapport punkt 1): exakt den loggtexten
      // felrapporten efterfrågade, så en testare entydigt kan se i konsolen
      // att GPS-läget faktiskt kom fram till appen (innan AR-scenen ens
      // hunnit placera/rendera något), och inte behöva gissa utifrån den
      // mer utförliga "[AR][pipeline] GPS OK"-raden nedan.
      console.info(`[AR] GPS position mottagen (lat=${geo.lat.toFixed(5)}, lon=${geo.lon.toFixed(5)})`);
      console.info(`[AR][pipeline] GPS OK (lat=${geo.lat.toFixed(5)}, lon=${geo.lon.toFixed(5)}, accuracy=${geo.accuracy ?? "okänd"}m)`);
    }
  }, [geo.lat, geo.lon, geo.accuracy]);
  useEffect(() => {
    if (orientation.hasFix && !loggedCompassOkRef.current) {
      loggedCompassOkRef.current = true;
      console.info("[AR][pipeline] Compass OK (första kompassavläsning mottagen)");
    }
  }, [orientation.hasFix]);
  useEffect(() => {
    if (arSessionVisible && !loggedVisibleRef.current) {
      loggedVisibleRef.current = true;
      console.info("[AR][pipeline] Visible=true (GPS+kompass+kamera redo, AR-scenen visas)");
    }
  }, [arSessionVisible]);

  const wind = useWindSound();
  // Juli 2026-fix (produktfeedback, ny omgång): "info om ljudet dök upp lite
  // då och då, räcker med en gång" — `statusBanner` nedan visar "🔊 Vindljud
  // aktivt" varje gång INGET högre prioriterat meddelande råkar vara aktivt
  // just då (t.ex. mellan två "Kompass svag"-perioder), vilket ger upprepade
  // korta blinkningar av samma info under en och samma sammanhängande
  // ljuduppspelning. `windNoticeShownForThisPlaybackRef` låter bannern visas
  // EN gång per sammanhängande `wind.playing`-period istället för varje gång
  // den råkar bli den högst prioriterade statusen — återställs bara när
  // ljudet stängs av (t.ex. inomhus) så nästa distinkta uppspelning fortfarande
  // får sin egen enda avisering.
  const windNoticeShownForThisPlaybackRef = useRef(false);
  useEffect(() => {
    if (!wind.playing) {
      windNoticeShownForThisPlaybackRef.current = false;
    }
  }, [wind.playing]);
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
    pitchStabilityRef: orientation.pitchStabilityRef,
    calibrationComplete: orientation.calibrationComplete,
    orientationHasFix: orientation.hasFix,
  });

  // Minimikrav enligt produktkrav: minst 15-20% synlig himmel i bild innan
  // verk visas överhuvudtaget, oavsett vad de övriga signalerna i indexet
  // ovan säger — en enstaka ljus yta (t.ex. en vit vägg) ska inte räcka.
  const MIN_SKY_RATIO = 0.15;
  const hasEnoughSky = sky.skyRatio >= MIN_SKY_RATIO;

  // Kompassnoggrannhet (iOS `webkitCompassAccuracy`): visas som en
  // kalibreringsbanner i AR-sessionen när iOS rapporterar dålig
  // magnetometermätning (> 20°). Pollas var 2:a sekund från ref-värdet —
  // inga React renders sker av sensorns rå event-ström.
  const [compassAccuracyDeg, setCompassAccuracyDeg] = useState<number | null>(null);
  useEffect(() => {
    if (!started) {
      setCompassAccuracyDeg(null);
      return;
    }
    const id = setInterval(() => {
      setCompassAccuracyDeg(orientation.headingAccuracyDegRef.current);
    }, 2000);
    return () => clearInterval(id);
  }, [started, orientation.headingAccuracyDegRef]);

  // Juli 2026-fix (fjärde buggrapporten): "de försvann direkt" — `sky.indoors`
  // (kamera-heuristikens hysteresis) kunde tidigare slå om till "inomhus" och
  // dämpa/rödmarkera verken på samma bildruta som kameran råkade svepa förbi
  // en mörk yta (t.ex. en TV, ett fönster i skugga), utan att användaren ens
  // hann se dem. Produktkrav: ge användaren en 5-sekunders "titta-gratis"-
  // period från det ögonblick kameran FÖRST bedöms vara inomhus/skymd innan
  // dämpningen/röda statusen slår till — men återgå OMEDELBART (ingen
  // fördröjning) så fort kameran igen ser fri himmel, så vi aldrig döljer en
  // faktisk återhämtning. Se `ar-tracking-freeze-vs-fade-tiering`-mönstret i
  // minnesanteckningarna: samma "instant på bra, fördröjd på dåligt"-princip.
  const INDOORS_GRACE_MS = 5000;
  const indoorsSinceRef = useRef<number | null>(null);
  const [indoorsGracePassed, setIndoorsGracePassed] = useState(false);
  // Åttonde kritiska buggrapporten (punkt 1, "verken visas aldrig, inte ens
  // några sekunder inomhus"): denna klocka startades TIDIGARE direkt av rå
  // `sky.indoors` — men `useSkyDetection` körs redan så fort kameran är igång
  // (`started`), LÅNGT innan GPS+kompass hunnit få sin fix och
  // `arSessionVisible`/`ready` blir sant. Om lägesbestämningen tar t.ex.
  // 10-15s (vanligt inomhus/dåligt GPS-läge, se debug-panelens "GPS dålig"),
  // hann femsekundersklockan redan räknas ut helt I BAKGRUNDEN — så i samma
  // ögonblick AR-vyn FAKTISKT blev synlig för användaren var
  // `indoorsGracePassed` redan `true`, och "titta-gratis"-perioden kändes som
  // att den aldrig fanns. Kräver nu ÄVEN `arSessionVisible` innan klockan
  // börjar räkna, så de utlovade 5 sekunderna alltid räknas från det
  // ögonblick användaren verkligen kan se AR-vyn, aldrig i förväg.
  useEffect(() => {
    if (!sky.indoors || !arSessionVisible) {
      indoorsSinceRef.current = null;
      setIndoorsGracePassed(false);
      return;
    }
    if (indoorsSinceRef.current === null) {
      indoorsSinceRef.current = Date.now();
    }
    const elapsed = Date.now() - indoorsSinceRef.current;
    if (elapsed >= INDOORS_GRACE_MS) {
      setIndoorsGracePassed(true);
      return;
    }
    const timeout = window.setTimeout(() => setIndoorsGracePassed(true), INDOORS_GRACE_MS - elapsed);
    return () => window.clearTimeout(timeout);
  }, [sky.indoors, arSessionVisible]);

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
  // Juli 2026-fix (fjärde buggrapporten): använder den 5-sekunders-graderade
  // `indoorsGracePassed` (se ovan) istället för det råa `sky.indoors` — så
  // verken hinner visas ett ögonblick innan de dämpas/döljs, men återgår
  // fortfarande omedelbart så fort kameran ser fri himmel igen.
  const indoorsOrNoSight = ready && sky.ready && indoorsGracePassed;

  // Liten alltid-synlig statusbadge: "Fri sikt" / "Delvis skymt" / "Ingen
  // fri sikt" — samma graderade inomhus-bedömning som ovan (`indoorsGracePassed`)
  // plus `sky.skyRatio` för ett mjukare mellanläge (skymd av t.ex. några träd,
  // men inte "inomhus") så signalen inte bara är på/av.
  const PARTIAL_SKY_RATIO_THRESHOLD = 0.6;
  const lineOfSightStatus: "clear" | "partial" | "indoors" = !sky.ready
    ? "clear"
    : indoorsGracePassed
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
      [nativePermError, preStartPermissionError, geo.error, orientation.error, camera.error].filter(
        (e): e is string => Boolean(e),
      ),
    [nativePermError, preStartPermissionError, geo.error, orientation.error, camera.error],
  );

  // Juli 2026-fix (produktkrav 2, "endast EN statusruta åt gången"): rapporteras
  // uppåt av `NearestTurbineArrow` via `onTargetChange` istället för att den
  // komponenten renderar sin egen bekräftelseruta oberoende av alla andra.
  const [nearestOnTarget, setNearestOnTarget] = useState(false);

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

  // Bäring (grader från norr) till samtliga verk — delar `stableGeo` med
  // `turbineDistancesM` ovan, så de två alltid syftar på exakt samma
  // (stabiliserade) position/index-ordning.
  const turbineBearingsDeg = useMemo(() => {
    if (stableGeo.lat === null || stableGeo.lon === null) return null;
    return activeTurbines.map((t) => {
      const { lat, lon } = swerefToWgs84(t.easting, t.northing);
      return bearingDegrees(stableGeo.lat as number, stableGeo.lon as number, lat, lon);
    });
  }, [activeTurbines, stableGeo.lat, stableGeo.lon]);

  // Reaktiv kompassriktning — `orientation.headingDegRef` är medvetet en ref
  // (uppdateras 30-60 ggr/s i ARScenes renderloop utan att trigga en
  // React-omrendering), så vi pollar den till state i en långsammare takt
  // (samma mönster som `NearestTurbineArrow`) för debug-panelen och
  // 2-sekunders-fallbacken nedan, som BÅDA behöver ett reaktivt värde.
  const [headingDegState, setHeadingDegState] = useState<number | null>(null);
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => {
      setHeadingDegState(orientation.headingDegRef.current);
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  const CALIBRATION_FALLBACK_TURBINE_COUNT = 3;
  const CALIBRATION_FALLBACK_DELAY_MS = 2000;

  // Antal laddade verk (produktkrav 2: debug-fält "turbines loaded count") —
  // samma mängd som skickas till `ARScene`.
  const loadedTurbineCount = activeTurbines.length;

  // Antal verk inom max-renderavstånd, OAVSETT riktning/synlighetsfaktor
  // (produktkrav 2: "within render distance count") — särskiljer "verket
  // finns inom räckhåll" från "verket råkar synas just nu".
  const withinRangeTurbineCount = useMemo(() => {
    if (!turbineDistancesM) return 0;
    return turbineDistancesM.filter((d) => d <= MAX_RENDER_DISTANCE_M).length;
  }, [turbineDistancesM]);

  // Antal verk som just nu ligger inom halva kamerans FOV OCH inom
  // renderavstånd (produktkrav 2: "in-front-of-camera count").
  //
  // Juli 2026-fix ("verk fastklistrade på skärmen vid nedåtlutning"): denna
  // räkning byggde tidigare på en EGEN, horisontell-only jämförelse mellan
  // `headingDegState` och `turbineBearingsDeg` — dvs. rå kompassriktning,
  // helt oberoende av hur mycket telefonen lutas upp/ner. Det gjorde att
  // kalibreringsfallbacken nedan (som denna räkning styr) antingen aldrig
  // triggade, eller förblev triggad, rent utifrån bäring — och tvingade då
  // verk att stanna/inte stanna kvar synliga oavsett vertikal siktlinje.
  // Läser nu istället av `ARScene`s egen, autoritativa räkning
  // (`getInFrontOfCameraCount`), som använder den FULLSTÄNDIGA 3D-vinkeln
  // (gir+pitch) mot kamerans verkliga optiska axel — samma tal som redan
  // styr "rakt fram"-garantins `forceVisible` inne i scenen, så de två
  // mekanismerna aldrig kan bli inbördes oense.
  const [inFrontOfCameraCount, setInFrontOfCameraCount] = useState(0);
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => {
      setInFrontOfCameraCount(arSceneRef.current?.getInFrontOfCameraCount() ?? 0);
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Juli 2026-fix (regressionsrapport punkt 8: persistent felsökningstext
  // med FPS/bildrutenummer) — pollas oftare (250ms) än de flesta andra
  // debug-talen ovan, eftersom hela poängen är att SNABBT kunna se att
  // renderloopen fortfarande lever (stigande bildrutenummer, rimlig FPS).
  const [arDebugStats, setArDebugStats] = useState({
    fps: 0,
    frameCount: 0,
    worldPositionsUpdated: false,
    visibleTurbineCount: 0,
    screenLocked: false,
    renderMode: "direct" as "direct" | "stabilizing" | "world-locked",
    trueVisibleTurbineCount: 0,
  });
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => {
      setArDebugStats(
        arSceneRef.current?.getDebugStats() ?? {
          fps: 0,
          frameCount: 0,
          worldPositionsUpdated: false,
          visibleTurbineCount: 0,
          screenLocked: false,
          renderMode: "direct",
          trueVisibleTurbineCount: 0,
        },
      );
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Juli 2026-fix (produktkrav 6, ny omgång): "Heading age (ms)" i
  // felsökningsraden — tid sedan senaste `deviceorientation`-händelsen,
  // oavsett om den kom via kompass eller (produktkrav 4) gyro-fallback.
  // Pollas i samma takt som övriga felsökningstal ovan.
  const [headingAgeMs, setHeadingAgeMs] = useState<number | null>(null);
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => {
      const lastAt = orientation.lastOrientationEventAtRef.current;
      setHeadingAgeMs(lastAt === null ? null : Date.now() - lastAt);
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Anledningar till att verk kan vara dolda just nu, för sensordebug-
  // panelen — samlar ihop de olika (annars separata) döljningsmekanismerna
  // i ett läsbart facit.
  const debugHideReasons = useMemo(() => {
    const reasons: string[] = [];
    // Vakthunden mot total sensortystnad (se `useDeviceOrientation.ts`)
    // listas FÖRST — den förklarar direkt varför pilen/verken kan verka
    // "frusna" trots att andra siffror (FPS, AR-stabilitet) ser bra ut,
    // eftersom just den siffran annars bara fryser kvar på sitt senaste
    // goda värde istället för att spegla att sensorn tystnat.
    if (orientation.orientationStalled) reasons.push("Rörelsesensorn svarar inte — försöker återansluta");
    if (indoorsOrNoSight) reasons.push("Inomhus/ingen fri sikt (kamera-heuristik)");
    if (mlActive && !hasEnoughSky) reasons.push("För lite synlig himmel i bild");
    if (mlActive && confidence.tier === "hide") reasons.push('Outdoor Confidence Index: "hide"');
    if (mlActive && confidence.tier === "aim") reasons.push('Outdoor Confidence Index: "aim" (rikta mot himlen)');
    if (arTracking.freeze) reasons.push(WEAK_SIGNAL_MESSAGE);
    if (arTracking.fadeFactor < 1) reasons.push("Tonas ut — spårning saknad för länge");
    return reasons;
  }, [
    orientation.orientationStalled,
    indoorsOrNoSight,
    mlActive,
    hasEnoughSky,
    confidence.tier,
    arTracking.freeze,
    arTracking.fadeFactor,
  ]);

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

  // Vinkelskillnad (grader, alltid ≥0) mellan aktuell kompassriktning och
  // bäringen till närmaste verk (produktkrav 2: "angular diff
  // camera↔turbine") — delar `nearestTurbineInfo` med pilen/monitorn.
  const angleDiffToNearestDeg = useMemo(() => {
    if (nearestTurbineInfo === null || headingDegState === null) return null;
    return Math.abs(normalizeAngle(headingDegState - nearestTurbineInfo.bearingDeg));
  }, [nearestTurbineInfo, headingDegState]);

  // Tre närmaste verkens id:n, sorterade på avstånd — underlaget för
  // 2-sekunders-kalibreringsfallbacken nedan ("visa de 3 närmaste som
  // AR-testobjekt").
  const nearestThreeTurbineIds = useMemo(() => {
    if (!turbineDistancesM) return [];
    return activeTurbines
      .map((t, i) => ({ id: t.id, d: turbineDistancesM[i] }))
      .sort((a, b) => a.d - b.d)
      .slice(0, CALIBRATION_FALLBACK_TURBINE_COUNT)
      .map((x) => x.id);
  }, [activeTurbines, turbineDistancesM]);

  // Produktkrav 3: om INGA verk legat inom kamerans FOV under 2 sammanhängande
  // sekunder (medan AR-sessionen faktiskt är synlig/redo) tvingas de tre
  // närmaste verken synliga som "AR-testobjekt" (via `forceVisibleIds` till
  // `ARScene`, se dess jsdoc), tillsammans med en icke-blockerande
  // kalibreringsbanderoll. Låser ALDRIG appen i kalibreringsläge — så fort
  // minst ett verk naturligt hamnar i FOV igen (`inFrontOfCameraCount > 0`)
  // stängs fallbacken av igen automatiskt, utan att kräva någon
  // användaråtgärd.
  const [calibrationFallbackActive, setCalibrationFallbackActive] = useState(false);
  const noTurbinesInFrontSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!arSessionVisible || !ready || inFrontOfCameraCount > 0) {
      noTurbinesInFrontSinceRef.current = null;
      setCalibrationFallbackActive(false);
      return;
    }
    if (noTurbinesInFrontSinceRef.current === null) {
      noTurbinesInFrontSinceRef.current = Date.now();
    }
    const elapsed = Date.now() - noTurbinesInFrontSinceRef.current;
    if (elapsed >= CALIBRATION_FALLBACK_DELAY_MS) {
      // Juli 2026-fix (kritisk buggrapport punkt 6, "safety rule: force-
      // recreate/force-show + log if nothing visible within 2s"): explicit
      // konsolvarning så en testare/utvecklare ser exakt NÄR och VARFÖR
      // säkerhetsnätet triggade, inte bara att verk plötsligt dök upp.
      console.warn(
        `[AR][safety] No turbines in camera FOV for ${CALIBRATION_FALLBACK_DELAY_MS}ms — force-showing ${nearestThreeTurbineIds.length} nearest turbines`,
      );
      setCalibrationFallbackActive(true);
      return;
    }
    const id = window.setTimeout(() => {
      console.warn(
        `[AR][safety] No turbines in camera FOV for ${CALIBRATION_FALLBACK_DELAY_MS}ms — force-showing ${nearestThreeTurbineIds.length} nearest turbines`,
      );
      setCalibrationFallbackActive(true);
    }, CALIBRATION_FALLBACK_DELAY_MS - elapsed);
    return () => window.clearTimeout(id);
  }, [arSessionVisible, ready, inFrontOfCameraCount, nearestThreeTurbineIds]);

  const forceVisibleIds = useMemo(() => {
    if (!calibrationFallbackActive || nearestThreeTurbineIds.length === 0) return undefined;
    return new Set(nearestThreeTurbineIds);
  }, [calibrationFallbackActive, nearestThreeTurbineIds]);

  // Juli 2026-fix (produktkrav 2): "Endast EN statusruta/toast ska visas åt
  // gången" — tidigare kunde felmeddelanden, målbekräftelsen, svag-signal-
  // varningen, "Vindljud aktivt"-taggen och kalibreringsbanderollerna alla
  // vara aktiva SAMTIDIGT och staplas på varandra i samma skärmzon. All den
  // logiken samlas nu i EN prioriterad statusruta enligt kravets
  // ordning: kritiska fel > "tittar mot närmaste verk"-bekräftelse >
  // svag positionering (inkl. produktkrav 4:s "Kompass svag – använder
  // rörelsedata"-fallback) > ljud aktivt. Kalibreringsmeddelandena delade
  // redan denna skärmzon innan denna fix, så de hänger med som lägst
  // prioriterade — annars skulle de kunna dyka upp SAMTIDIGT som t.ex.
  // ljud-taggen igen.
  const statusBanner = useMemo<{ message: string; tone: "red" | "green" | "yellow" | "orange" } | null>(() => {
    if (!arSessionVisible) return null;
    if (errors.length > 0) {
      return { message: errors[0], tone: "red" };
    }
    if (nearestOnTarget && nearestTurbineInfo) {
      return { message: `✓ Du tittar mot närmaste verk (${formatDistance(nearestTurbineInfo.distanceM)})`, tone: "green" };
    }
    // Vakthunden mot total sensortystnad (se `useDeviceOrientation.ts`) går
    // FÖRE den vanliga "Kompass svag"-varningen — den täcker ett strikt
    // allvarligare läge (rörelsesensorn har SLUTAT skicka data helt, inte
    // bara en osäker avläsning), och användaren behöver ett tydligt annat
    // besked ("försöker återansluta") än den vanliga gyro-fallback-texten.
    if (orientation.orientationStalled) {
      return { message: "⚠️ Rörelsesensorn svarar inte – försöker återansluta", tone: "red" };
    }
    if (orientation.headingFallbackActive) {
      return { message: "⚠️ Kompass svag – använder rörelsedata", tone: "yellow" };
    }
    if (arTracking.weakSignalMessage) {
      return { message: `⚠️ ${arTracking.weakSignalMessage}`, tone: "yellow" };
    }
    // Juli 2026-fix (kritisk buggrapport punkt 4): ersätter den tidigare
    // skärmtäckande svarta inomhus-overlayen. Verken visas numera ALLTID,
    // bara dämpade/gråblåtonade (se `INDOOR_DIM_FACTOR`/tint i
    // `ARScene.tsx`), så en liten, icke-blockerande statusrad räcker som
    // indikator istället för att täcka hela vyn.
    if (indoorsOrNoSight) {
      return {
        message: "🏠 Skymd/inomhus – verken visas dämpade. Ljudet fortsätter baserat på din position.",
        tone: "yellow",
      };
    }
    // Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 4): explicit
    // fallback-text när INGET verk just nu räknas synligt (arDebugStats.
    // trueVisibleTurbineCount — den faktiska, opacitetsbaserade räkningen
    // från ARScene, se dess jsdoc) — så användaren aldrig bara möter en tom
    // skärm utan förklaring/vägledning, oavsett ORSAKEN (utanför FOV,
    // "Visa/dölj verk" avstängd, etc). Lägre prioriterad än
    // indoorsOrNoSight-bannern ovan, som redan förklarar det specifika
    // inomhus-/skymd-fallet.
    if (turbinesVisible && arDebugStats.trueVisibleTurbineCount === 0) {
      return { message: "Verken ligger åt pilens riktning – vrid mobilen", tone: "yellow" };
    }
    // Juli 2026-fix (produktfeedback, ny omgång): visa "Vindljud aktivt"
    // bara EN gång per sammanhängande uppspelning (se
    // `windNoticeShownForThisPlaybackRef` ovan), annars blinkar samma info
    // upp på nytt varje gång inget annat meddelande råkar vara aktivast just
    // då. Flaggan sätts här (i render) snarare än i en effekt, eftersom den
    // bara får sättas när bannern FAKTISKT visas för användaren, inte bara
    // när `wind.playing` blir sant.
    if (wind.playing && !windNoticeShownForThisPlaybackRef.current) {
      windNoticeShownForThisPlaybackRef.current = true;
      return { message: "🔊 Vindljud aktivt", tone: "orange" };
    }
    if (calibrated) {
      return { message: "Horisont kalibrerad!", tone: "orange" };
    }
    if (stillCalibrating) {
      return {
        message: "Kalibrerar kompass i bakgrunden – fortsätt röra telefonen långsamt för bättre precision.",
        tone: "yellow",
      };
    }
    return null;
  }, [
    arSessionVisible,
    errors,
    nearestOnTarget,
    nearestTurbineInfo,
    orientation.orientationStalled,
    orientation.headingFallbackActive,
    arTracking.weakSignalMessage,
    indoorsOrNoSight,
    turbinesVisible,
    arDebugStats.trueVisibleTurbineCount,
    wind.playing,
    calibrated,
    stillCalibrating,
  ]);

  const statusBannerToneClasses: Record<"red" | "green" | "yellow" | "orange", string> = {
    red: "bg-red-500/90 text-white",
    green: "bg-emerald-500/90 text-[#062b17]",
    yellow: "bg-yellow-500/90 text-[#090909]",
    orange: "bg-[#FF8B01]/90 text-[#090909]",
  };

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
  // beräknade ljudnivån ändras. Utomhusvolymen räknas fram från den RÅA,
  // icke-utjämnade `rawOutdoorEstimate.totalDba` — INTE den flera sekunder
  // fördröjda `smoothedOutdoorDba` (som bara finns för den VISADE panel-
  // siffran) — så att `useWindSound`s egen högfrekventa (`AUDIO_TICK_MS`)
  // EMA-loop är den ENDA utjämningen volymen någonsin går igenom, precis
  // enligt produktkravet ("räkna om minst 10 ggr/sekund", inte i GPS-takt
  // och sedan igen i panelens flera-sekunders utjämningsfönster).
  // "Ljud inne" appliceras sedan som en direkt, garanterad multiplikator
  // (`applyIndoorGain`) på den REDAN beräknade volymen — INTE genom att köra
  // en redan -35 dB-dämpad dBA-siffra genom `dbaToVolume`s golv/tak-
  // klippning igen. Se `applyIndoorGain`s jsdoc: det gamla sättet klippte
  // "Ljud inne"-volymen till exakt 0 för i praktiken alla realistiska
  // utomhusnivåer, så om utomhusnivån redan låg nära `dbaToVolume`s golv
  // (vanligt på riktiga GPS-avstånd i Katrineholm) gav växlingen ingen
  // hörbar skillnad alls — den rapporterade buggen.
  const windTargetVolume = useMemo(
    () => applyIndoorGain(dbaToVolume(rawOutdoorEstimate.totalDba), soundEnvironment === "inne"),
    [rawOutdoorEstimate.totalDba, soundEnvironment],
  );
  useEffect(() => {
    if (!wind.playing) return;
    wind.updateProximity(windTargetVolume, AVG_RPM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wind.playing, windTargetVolume]);

  const handleStart = useCallback(() => {
    // *** THIS IS THE REWRITTEN HANDLER — v2 sequential permissions ***
    console.log("[AR] Start button pressed");
    console.log("[AR] isNative:", isNative(), "| starting:", starting);

    // Double-tap guard: ignorera knapptryck om ett flöde redan pågår.
    if (starting) {
      console.log("[AR] Already starting, ignoring tap");
      return;
    }

    setStarting(true);
    setNativePermError(null);
    setShowLoadingSequence(true);

    // Ljud på som standard: startas direkt från samma knapptryckning (giltigt
    // användargest för iOS Safaris ljuduppspelningsregler), innan ev. await
    // nedan, så AudioContext skapas/låses upp synkront i gestens "kontext".
    void wind.toggle();

    const finish = () => {
      console.log("[AR] Starting compass (startCalibrationTracking)");
      orientation.startCalibrationTracking();
      console.log("[AR] Navigating to AR scene (setStarted true)");
      setStarted(true);
      setStarting(false);
    };

    // -----------------------------------------------------------------------
    // Native iOS/Android: kamera- och platsbehörighet begärs SEKVENTIELLT via
    // Capacitor-plugin, INNAN setStarted(true) anropas. Parallella iOS-dialoger
    // fryser appen. requestAllPermissionsSequentially() sätter
    // _nativePermissionsGranted så att useCameraStream/useGeolocation hoppar
    // över att begära behörighet en gång till.
    // -----------------------------------------------------------------------
    if (isNative()) {
      console.log("[AR] Native path: calling requestAllPermissionsSequentially");
      void requestAllPermissionsSequentially()
        .then(({ camera, location, error }) => {
          console.log("[AR] requestAllPermissionsSequentially result: camera=", camera, "location=", location, "error=", error ?? "none");
          if (!camera || !location) {
            console.warn("[AR] Permission denied, aborting start. error:", error);
            setNativePermError(error ?? "Behörighet nekad.");
            setStarting(false);
            setShowLoadingSequence(false);
            return;
          }
          console.log("[AR] All permissions granted, waiting 400 ms before starting services");
          setTimeout(() => {
            console.log("[AR] 400 ms elapsed, checking compass permission. needsPermission:", orientation.needsPermission);
            if (orientation.needsPermission) {
              console.log("[AR] Requesting compass permission");
              void orientation.requestPermission()
                .then((result) => { console.log("[AR] Compass permission result:", result); })
                .catch((err: unknown) => { console.error("[AR] Compass permission error:", err); })
                .finally(finish);
            } else {
              finish();
            }
          }, 400);
        })
        .catch((err: unknown) => {
          console.error("[AR] requestAllPermissionsSequentially threw:", err);
          const msg = err instanceof Error ? err.message : String(err);
          setNativePermError(`Fel vid behörighetsbegäran: ${msg}`);
          setStarting(false);
          setShowLoadingSequence(false);
        });
      return;
    }

    // -----------------------------------------------------------------------
    // Webb: kamera- och GPS-dialogen triggas parallellt i samma gest-fönster.
    // OBS enableHighAccuracy: false — resultatet kastas bort; konkurrerar ej
    // om GPS-chipet med den riktiga watchPosition-bevakningen.
    // -----------------------------------------------------------------------
    console.log("[AR] Web path: requesting camera + location in parallel");
    navigator.geolocation?.getCurrentPosition(
      () => {},
      () => {},
      { enableHighAccuracy: false, timeout: 15000, maximumAge: Infinity },
    );
    navigator.mediaDevices
      ?.getUserMedia?.({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => {});

    if (orientation.needsPermission) {
      void orientation.requestPermission().finally(finish);
    } else {
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, starting]);

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
      if (!arSceneRef.current) {
        setPhotoError("Kunde inte ta bild — AR-vyn är inte redo.");
        return;
      }
      if (!video && !camera.nativePreview) {
        setPhotoError("Kunde inte ta bild — kameran är inte redo.");
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

      const width = video?.videoWidth || arImage.width || window.screen.width || 1080;
      const height = video?.videoHeight || arImage.height || window.screen.height || 1920;

      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const ctx = out.getContext("2d");
      if (!ctx) {
        setPhotoError("Kunde inte ta bild — canvas stöds inte.");
        return;
      }

      if (video) {
        // Webb: kamerabild från video-element med object-cover-beskärning.
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
      } else {
        // Native: fånga bildruta från CameraPreview-plugin
        const cameraDataUrl = await captureNativeCameraPhoto();
        if (cameraDataUrl) {
          const cameraImg = new Image();
          await new Promise<void>((resolve) => {
            cameraImg.onload = () => resolve();
            cameraImg.onerror = () => resolve();
            cameraImg.src = cameraDataUrl;
          });
          ctx.drawImage(cameraImg, 0, 0, width, height);
        } else {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, width, height);
        }
      }

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
  }, [camera.nativePreview]);

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden text-white ${camera.nativePreview ? "bg-transparent" : "bg-[#090909]"}`}>
      {!started && (
        <PermissionGate
          onStart={handleStart}
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

          <CameraBackground stream={camera.stream} videoRef={videoElRef} nativePreview={camera.nativePreview} />

          {/* PRESTANDA (produktkrav juli 2026): `ARScene` monteras redan här,
              så fort `started` är sant — INTE bara när `arSessionVisible`
              blir sant. Dess tunga engångskostnad (bygga 29 procedurella
              3D-modeller, canvas-texturer, material och shader-kompilering
              via `onBeforeCompile`, se `ARScene.tsx`) sker alltså i
              bakgrunden UNDER `LoadingSequence`s animation, istället för att
              blockera huvudtråden precis i det ögonblick användaren
              förväntar sig se verken. Komponenten hålls kvar monterad hela
              AR-sessionen och styrs bara av sin `visible`-prop (opacitet på
              en redan existerande canvas) — objekten skapas alltså EN gång,
              och "AR-start" är bara en synlighets-toggle, aldrig en
              nykonstruktion. Innan en riktig GPS-fix finns används
              Katrineholms centrum som en tillfällig platshållarposition;
              `ARScene`s egen animate-loop upptäcker automatiskt när
              `userLat`/`userLon` sedan hoppar till den riktiga positionen
              (samma "har flyttat sig"-koll som annars bara triggar en vanlig
              omplacering) och lägger om verken direkt, utan att skapa om
              något. */}
          <ARScene
            ref={arSceneRef}
            visible={arSessionVisible}
            userLat={smoothedGeo.lat ?? geo.lat ?? KATRINEHOLM_CENTER.lat}
            userLon={smoothedGeo.lon ?? geo.lon ?? KATRINEHOLM_CENTER.lon}
            quaternionRef={orientation.quaternionRef}
            headingDegRef={orientation.headingDegRef}
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
            forceVisibleIds={forceVisibleIds}
            debugForceNearest={debugForceNearest}
            disableOcclusion={debugDisableOcclusion}
            arStartedAtMs={arStartedAtMs}
            turbinesVisible={turbinesVisible}
          />

          {arSessionVisible && (
            <NearestTurbineArrow
              getCurrentHeading={orientation.getCurrentHeading}
              bearingDeg={nearestTurbineInfo?.bearingDeg ?? null}
              distanceM={nearestTurbineInfo?.distanceM ?? null}
              indoors={indoorsOrNoSight}
              compassQualityPercent={arTracking.compassQualityPercent}
              onTargetChange={setNearestOnTarget}
            />
          )}

          {/* Kompasskalibreringsbanner: visas i AR-sessionen när iOS rapporterar
              dålig magnetometermätning (webkitCompassAccuracy > 20°). Z-index
              45 = ovanför inomhus-overlay (z-40) men under pilpekaren (z-50). */}
          {arSessionVisible && compassAccuracyDeg !== null && compassAccuracyDeg > 20 && (
            <div
              className="pointer-events-none absolute inset-x-4 z-[45] rounded-xl bg-orange-950/90 px-4 py-3 shadow-xl backdrop-blur-sm"
              style={{ top: "5rem" }}
            >
              <p className="text-sm font-semibold text-orange-200">🧭 Kalibrera kompassen</p>
              <p className="mt-0.5 text-xs text-white/80">
                Vinkla telefonen i ett ∞-mönster för bättre noggrannhet
              </p>
              <p className="mt-0.5 text-[10px] text-orange-400">
                Osäkerhet: ±{Math.round(compassAccuracyDeg)}°
              </p>
            </div>
          )}

          {/* Juli 2026-fix (produktfeedback, ny omgång): föregående fix gated
              raden helt bakom `showSensorDebug` efter klagomål på "text i
              vägen" — men användaren saknade sedan den lilla, alltid synliga
              statusinfon ("den gröna texten") och bad om att få tillbaka den,
              bara mindre/kompaktare. Kompromiss: raden är åter alltid synlig
              (ingen `showSensorDebug`-gate), men storleken (font/padding) är
              minskad ytterligare jämfört med den ursprungliga versionen, så
              den tar mindre plats och stör mindre. Den fullständiga,
              interaktiva `SensorDebugPanel` är fortfarande kvar bakom
              "Felsökning" för djupare felsökning. */}
          {arSessionVisible && (
            <LiveDebugStrip
              measureRef={debugStripRef}
              fps={arDebugStats.fps}
              frameCount={arDebugStats.frameCount}
              headingDeg={headingDegState}
              bearingToNearestDeg={nearestTurbineInfo?.bearingDeg ?? null}
              angleDiffToNearestDeg={angleDiffToNearestDeg}
              gpsAccuracyM={geo.accuracy}
              headingAccuracyDeg={orientation.headingAccuracyDegRef.current}
              renderedTurbineCount={withinRangeTurbineCount}
              visibleTurbineCount={visibleTurbineCount}
              headingAgeMs={headingAgeMs}
              headingSource={orientation.headingSourceRef.current}
              motionFusionActive={orientation.motionFusionActive}
              worldUpdated={arDebugStats.worldPositionsUpdated}
              arVisibleTurbineCount={arDebugStats.visibleTurbineCount}
              screenLocked={arDebugStats.screenLocked}
              renderMode={arDebugStats.renderMode}
              trueVisibleTurbineCount={arDebugStats.trueVisibleTurbineCount}
              nearestDistanceM={nearestTurbineInfo?.distanceM ?? null}
            />
          )}

          {/* Dagsläge stänger av mörkläggningen helt, oavsett vilket
              visualiseringsläge (t.ex. "Kväll") som är valt — bara det
              manuella Nattläge-valet styr detta filter. */}
          {arSessionVisible && nightMode && (
            <div className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-b from-[#0a1030]/55 via-[#0a1030]/35 to-[#0a1030]/60" />
          )}

          {!ready && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 px-8 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF8B01] border-t-transparent" />
              <p className="text-sm text-white/90">
                {!cameraActive && "Startar kameran…"}
                {cameraActive && geo.lat === null && "Väntar på GPS-signal…"}
              </p>

              {/* Statuspanel: visar GPS/kompass/kamera/AR-status var för sig
                  så en användare (eller testare) alltid ser EXAKT vad som
                  saknas, istället för att bara gissa utifrån en enda
                  textrad. */}
              <ul className="w-full max-w-xs space-y-1 rounded-xl bg-black/30 p-3 text-left text-[11px] text-white/70">
                <li className="flex items-center justify-between">
                  <span>📷 Kamera</span>
                  <span>{cameraActive ? "✅ Redo" : camera.error ? "❌ Fel" : "⏳ Startar…"}</span>
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

              {/* Samma hjälptext som produktkravet specificerar för det enda
                  kvarvarande blockerande läget (GPS), så användaren aldrig
                  bara ser en snurrande spinner utan förklaring. Kompassen
                  blockerar sedan juli 2026 aldrig `ready` — se motiveringen
                  vid `ready` ovan. */}
              {cameraActive && geo.lat === null && (
                <p className="text-xs text-white/50">Gå gärna ut på en öppen plats och rikta telefonen mot himlen.</p>
              )}
              {cameraActive && geo.lat === null && !geo.error && (
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

          {/* Juli 2026-fix (kritisk buggrapport punkt 4, "turbinerna måste
              förbli synliga inomhus — aldrig helt försvinna"): den tidigare
              skärmtäckande svarta "inomhus"-overlayen (bg-black/85, z-40) är
              BORTTAGEN. Verken visas numera ALLTID i ARScene, bara dämpade/
              gråblåtonade (se `INDOOR_DIM_FACTOR`/tint-konstanterna och
              `applyFinalOpacities` i ARScene.tsx), så inget behöver längre
              maskera hela vyn. Statusen kommuniceras istället som en liten,
              icke-blockerande rad via `statusBanner` nedan. */}

          {/* Juli 2026-fix (produktkrav 2, "endast EN statusruta åt gången"):
              denna enda platsen ersätter fyra tidigare oberoende banderoller
              ("Horisont kalibrerad!", "Kalibrerar kompass...",
              "Kalibrerar visning – rör mobilen långsamt i en åtta", samt
              svag-signal-/ljud-meddelanden i topp-baren) som tidigare kunde
              visas samtidigt och staplas på varandra. `statusBanner` väljer
              redan ut EXAKT en enligt prioritetsordningen, se dess jsdoc. */}
          {/* Juli 2026-fix (produktfeedback, ny omgång: "gör det smartare,
              tar för mycket plats och skymmer varandra"): `top-32`/`8rem`
              var fortfarande ett GISSAT fast värde som antog att topp-baren
              alltid tog exakt den höjden — men badge-raden radbryter numera
              (`flex-wrap`) beroende på hur många statusbadgar/knappar som
              råkar visas, så topp-barens verkliga höjd varierar. Ett gissat
              tal hann aldrig ikapp det och bannern hamnade mitt i knapparna
              (se skärmdump i produktfeedbacken). Använder nu `topBarHeight`
              — samma verkligt uppmätta höjd (via `ResizeObserver` på
              `topBarRef`) som redan används för att placera felsöknings-
              raden ovanför — så bannern ALLTID hamnar precis under topp-
              baren, oavsett hur många rader den råkar rendera just nu. */}
          {arSessionVisible && statusBanner && (
            <div
              className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-6"
              style={{ top: `${topBarHeight + debugStripHeight + 10}px` }}
            >
              <span
                className={`max-w-xs rounded-full px-4 py-1.5 text-center text-xs font-medium shadow-lg ${statusBannerToneClasses[statusBanner.tone]}`}
              >
                {statusBanner.message}
              </span>
            </div>
          )}

          {/* Top bar — z-45: MÅSTE ligga ovanför inomhus-/fri sikt-overlayen
              (z-40, se nedan) annars visas den "framför" (ovanpå, döljande)
              statusbadgarna precis som produktkravet beskriver för
              knapparna. Ligger fortfarande under pilen/målbekräftelsen (z-50).
              Juli 2026-fix: gated bakom `arSessionVisible` istället för att
              vara helt ovillkorad — annars hann HUD:en (badges, knappar) med
              tid ritas ovanpå `LoadingSequence`s laddnings-/kalibrerings-
              skärm (se `arSessionVisible`s jsdoc ovan). */}
          {arSessionVisible && (
          <div
            ref={topBarRef}
            className="absolute inset-x-0 top-0 z-[45] flex flex-col gap-2 bg-gradient-to-b from-black/70 to-transparent pb-8"
            style={{
              // Juli 2026-fix (produktfeedback, ny omgång: "flytta den gröna
              // texten högst upp och flytta ner allt annat lite"):
              // `LiveDebugStrip` ligger nu fast överst (se dess jsdoc), så
              // topp-baren måste själv skjutas ner med remsans FAKTISKA
              // renderade höjd (`debugStripHeight`, plus ett litet
              // mellanrum) ovanpå den befintliga säkra-zon-paddingen —
              // annars hamnar remsan ovanpå loggan/badges igen.
              paddingTop:
                debugStripHeight > 0
                  ? `calc(max(1rem, env(safe-area-inset-top)) + ${debugStripHeight + 6}px)`
                  : "max(1rem, env(safe-area-inset-top))",
              paddingLeft: "max(1rem, env(safe-area-inset-left))",
              paddingRight: "max(1rem, env(safe-area-inset-right))",
            }}
          >
            {/* Juli 2026-fix: statusbadge-raden klipptes/doldes på iPhone —
                orsaken var dubbel: (1) fasta sidopaddingar (`px-4`) ignorerade
                hela `env(safe-area-inset-*)` i landskapsläge (skärmens rundade
                hörn/"notch"), och (2) `flex-wrap` + `justify-end` på en rad
                med FLER badges än skärmbredden gjorde att överskjutande
                badges radbröts UTANFÖR den synliga höjden istället för att bli
                nåbara. Fixat genom att låta badge-raden själv scrolla
                horisontellt (`overflow-x-auto`, `whitespace-nowrap`, INTE
                `flex-wrap`) — och medvetet UTAN `justify-end`, eftersom
                `justify-content: flex-end` tillsammans med `overflow-x-auto`
                är en känd Chrome-bugg som gör innehåll som "skjuts ut" åt
                vänster om den synliga rutan helt onåbart via scroll. */}
            <div className="flex items-start gap-2">
              <div className="shrink-0">
                <p className="text-xs font-semibold tracking-wide text-[#FFB347]">VINDKOLLEN AR</p>
                <p className="text-sm text-white/90">
                  {usingCustomPlacement ? "Vindkollen" : "Katrineholm"} · {activeTurbines.length} verk{usingCustomPlacement && " · din placering"}
                </p>
              </div>
              {/* Juli 2026-fix (produktfeedback, ny omgång): "man borde ha röd
                  indikation på kompassen så man ständigt ser status" —
                  `CompassStabilityBadge` fanns redan och är redan alltid
                  synlig/live (grön/gul/röd), men låg som TREDJE badge i denna
                  horisontellt scrollbara rad, så på smala skärmar hamnade den
                  ofta utanför synligt område (kräver en scroll-gest ingen vet
                  om) — användaren såg bara GPS/AR-stabilitet och trodde
                  kompassstatus bara fanns som den tillfälliga gula
                  "Kompass svag"-bannern. Flyttad till PLATS 2 (direkt efter
                  GPS) så den nästan alltid ryms inom den synliga bredden.

                  Juli 2026-fix (ny omgång, produktfeedback: "en liten grön
                  ruta syns inte helt uppe till höger"): badge-raden var
                  fortfarande `overflow-x-auto`/`whitespace-nowrap` — dvs.
                  badges som inte fick plats krävde en osynlig, ovetad
                  scroll-gest för att nås, och visades i praktiken bara som
                  en avklippt, förvirrande färgsliver (`ArStabilityBadge`,
                  fjärde badgen) i högerkanten. Den ursprungliga oron kring
                  `flex-wrap` (se den gamla kommentaren ovan, kvar för
                  historik) gällde en tidigare version där topp-baren låg i
                  en höjdbegränsad, klippt behållare — men `topBarRef`s
                  `<div>` (se `Home.tsx`s `topBarHeight`-effekt) mäter och
                  anpassar sig redan efter sin FAKTISKA innehållshöjd, och
                  sitter som ett `position: absolute`-lager ovanpå resten av
                  vyn (inte i ett höjdbegränsat flöde), så ett extra
                  radbrott där badges inte får plats kostar bara några extra
                  pixlar högst upp — helt synligt, ingen gissad scroll
                  krävs. Bytt till `flex-wrap` (ingen `overflow-x-auto`/
                  `whitespace-nowrap`/dold scrollbar längre). */}
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pb-0.5">
                <GpsQualityBadge quality={arTracking.debug.gpsQuality} accuracyM={arTracking.debug.gpsAccuracyM} />
                <CompassStabilityBadge percent={arTracking.compassQualityPercent} />
                {/* Juli 2026-fix (produktfeedback, ännu en omgång: "nu har vi
                    glömt informationen om infraljudet"): dBA-badgen och
                    Infraljud-badgen är HÄLSO-/säkerhetsrelaterad information
                    (ljudnivå + infraljudspåverkan), inte teknisk
                    sensordebug-status — de hör hemma i den alltid synliga
                    raden, inte gömda bakom "Mer status". Bara de rent
                    tekniska trackingbadgarna (AR-stabilitet%, Fri sikt) är
                    kvar bakom den hopfällda knappen, se raden nedan. */}
                <SoundLevelBadge estimate={soundLevelEstimate} indoors={soundEnvironment === "inne"} />
                <NoiseImpactBadge
                  result={noiseImpact}
                  expanded={showNoiseImpact}
                  onToggle={() => setShowNoiseImpact((v) => !v)}
                />
                {/* Juli 2026-fix (produktfeedback, ny omgång: "gör det
                    smartare, tar för mycket plats"): de två rent tekniska
                    trackingbadgarna (AR-stabilitet%, Fri sikt) flyttades
                    bakom denna hopfällda knapp istället för att alltid
                    rendera en extra rad. GPS/Kompass/dBA/Infraljud (de fyra
                    som är antingen kritiska för sensorstatus eller hälso-/
                    säkerhetsrelevanta) förblir alltid synliga. */}
              </div>
            </div>
            {showStatusDetails && (
              <div className="flex flex-wrap items-center gap-1.5 pl-0.5">
                <ArStabilityBadge percent={arTracking.positioningConfidencePercent} />
                <LineOfSightStatus status={lineOfSightStatus} />
              </div>
            )}
            {/* Nattläge/Ljudnivå/Ljud ute + Mer status + gear på SAMMA rad */}
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {nightMode && (
                  <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-[11px] text-red-200">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                    Nattläge
                  </span>
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
                <button
                  onClick={() => setSoundEnvironment((v) => (v === "ute" ? "inne" : "ute"))}
                  aria-pressed={soundEnvironment === "inne"}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 aria-pressed:bg-[#FF8B01]/25 aria-pressed:text-[#FFB347]"
                >
                  {soundEnvironment === "ute" ? "🔊 Ljud ute" : "🔈 Ljud inne"}
                </button>
              </div>
              <button
                onClick={() => setShowStatusDetails((v) => !v)}
                aria-pressed={showStatusDetails}
                aria-label={showStatusDetails ? "Dölj fler statusdetaljer" : "Visa fler statusdetaljer"}
                className="shrink-0 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-white/20 aria-pressed:bg-white/20"
              >
                {showStatusDetails ? "▴ Mindre" : "▾ Mer status"}
              </button>
              <button
                onClick={() => setShowControls(true)}
                aria-pressed={showControls}
                aria-label="Visningsinställningar"
                className="shrink-0 rounded-full bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
              >
                ⚙️
              </button>
            </div>
          </div>
          )}

          {/* Juli 2026-fix (produktfeedback, ny omgång): samma fix som
              statusbannern ovan — byt gissat `7.5rem` mot det verkligt
              uppmätta `topBarHeight`, annars krockar den här banderollen med
              knapparna varje gång topp-baren radbryter till fler rader. */}
          {arSessionVisible && photoError && (
            <div
              className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4"
              style={{ top: `${topBarHeight + debugStripHeight + 10}px` }}
            >
              <span className="rounded-full bg-red-500/20 px-4 py-1.5 text-xs text-red-200 shadow-lg">{photoError}</span>
            </div>
          )}

          {/* Bottom controls — z-[45] av samma anledning som topp-baren ovan:
              får ALDRIG hamna bakom (visuellt dolda av) inomhus-overlayen
              (z-40). Dessa knappar ("Jag vill skriva på", "Fotomontage",
              "Visa karta", "Om projektet", "Placera vindkraftverken själv")
              måste alltid synas och gå att trycka på.
              Juli 2026-fix: precis som topp-baren, gated bakom
              `arSessionVisible` för att inte blöda igenom bakom
              `LoadingSequence`. */}
          {arSessionVisible && (
          <div className="absolute inset-x-0 bottom-0 z-[45] flex flex-col gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
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
            <button
              onClick={() => setShowMenu(true)}
              className="w-full rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              ☰ Meny
            </button>
          </div>
          )}

          {arSessionVisible && showMenu && (
            <div
              className="absolute inset-0 z-[55] flex flex-col justify-end bg-black/60"
              onClick={() => setShowMenu(false)}
            >
              <div
                className="flex flex-col gap-3 rounded-t-3xl border-t border-white/10 bg-[#111]/95 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Meny</p>
                  <button
                    onClick={() => setShowMenu(false)}
                    aria-label="Stäng meny"
                    className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/85 hover:bg-white/20"
                  >
                    ✕ Stäng
                  </button>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowMap(true);
                      setShowMenu(false);
                    }}
                    className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
                  >
                    Visa karta
                  </button>
                  <button
                    onClick={() => {
                      setShowInfo(true);
                      setShowMenu(false);
                    }}
                    className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
                  >
                    Om projektet
                  </button>
                </div>
                <button
                  onClick={openSverigekartan}
                  className="w-full rounded-full border border-[#FF8B01]/40 bg-[#FF8B01]/10 py-3 text-sm font-semibold text-[#FFB347] hover:bg-[#FF8B01]/20"
                >
                  🗺️ Sverigekartan – Öppna kartverktyg
                </button>
                {/* Juli 2026-fix (produktfeedback, ny omgång: "gör det
                    smartare, tar för mycket plats"): flyttade hit från
                    topp-baren — sällananvända engångsåtgärder, inte löpande
                    status som behöver synas hela tiden. Se kommentaren vid
                    knapparnas gamla plats i topp-baren ovan. */}
                <div className="flex gap-3">
                  {ready && (
                    <button
                      onClick={() => {
                        handleCalibrate();
                        setShowMenu(false);
                      }}
                      className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
                    >
                      🧭 Kalibrera horisont
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setTurbinesVisible((v) => !v);
                      setShowMenu(false);
                    }}
                    className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
                  >
                    {turbinesVisible ? "🌬️ Dölj verk" : "🌬️ Visa verk"}
                  </button>
                </div>
                {usingCustomPlacement && (
                  <button
                    onClick={() => {
                      handleClearCustomPlacement();
                      setShowMenu(false);
                    }}
                    className="w-full rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white/80 hover:bg-white/10"
                  >
                    ↩️ Återgå till planerad placering (29 verk)
                  </button>
                )}
              </div>
            </div>
          )}
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
          headingUpdatesPerSecond={orientation.updatesPerSecond}
          lastHeadingUpdateAgeMs={orientation.lastUpdateAgeMs}
          headingValuesFrozen={orientation.valuesFrozen}
          arTrackingTier={arTracking.tier}
          frozenForMs={arTracking.debug.frozenForMs}
          visibleTurbineCount={visibleTurbineCount}
          totalTurbineCount={activeTurbines.length}
          loadedTurbineCount={loadedTurbineCount}
          withinRangeTurbineCount={withinRangeTurbineCount}
          inFrontOfCameraCount={inFrontOfCameraCount}
          nearestDistanceM={nearestTurbineInfo?.distanceM ?? null}
          bearingToNearestDeg={nearestTurbineInfo?.bearingDeg ?? null}
          angleDiffToNearestDeg={angleDiffToNearestDeg}
          hideReasons={debugHideReasons}
          audioTargetDba={rawOutdoorEstimate.totalDba}
          audioTargetVolume={windTargetVolume}
          audioActualVolume={wind.actualVolumeRef.current}
          audioSource="Huvudhögtalare (MediaStreamAudioDestinationNode → dolt <audio>-element)"
          debugForceNearest={debugForceNearest}
          onToggleDebugForceNearest={() => setDebugForceNearest((v) => !v)}
          disableOcclusion={debugDisableOcclusion}
          onToggleDisableOcclusion={() => setDebugDisableOcclusion((v) => !v)}
          renderMode={arDebugStats.renderMode}
          onClose={() => setShowSensorDebug(false)}
        />
      )}

      {/* Diagnostikpanel — visas automatiskt på native (iOS/Android) */}
      <NativeDiagnostics />
    </div>
  );
}
