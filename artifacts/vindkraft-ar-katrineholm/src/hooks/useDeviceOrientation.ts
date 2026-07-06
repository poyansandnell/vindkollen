import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { computeDeviceQuaternion } from "@/lib/deviceOrientationMath";

interface DeviceOrientationEventiOS {
  requestPermission?: () => Promise<"granted" | "denied">;
}

interface DeviceMotionEventiOS {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export interface DeviceOrientationApi {
  supported: boolean;
  needsPermission: boolean;
  hasFix: boolean;
  /**
   * Sant först en liten stund efter `hasFix` — antingen när girriktningen
   * varit stabil (se `headingStabilityRef`) en sammanhängande stund, eller
   * efter en maxväntetid, beroende på vilket som inträffar först. Används
   * för att inte visa vindkraftverk förrän kompassen hunnit "räta in sig"
   * efter start, istället för att direkt lita på en enda första avläsning
   * som (särskilt vid magnetiska störningar inomhus) kan vara kraftigt fel.
   */
  hasSettled: boolean;
  error: string | null;
  requestPermission: () => Promise<boolean>;
  calibrateHorizon: () => void;
  /** Muteras varje sensoravläsning — kamerans quaternion kan kopieras direkt från denna ref utan re-render. */
  quaternionRef: React.MutableRefObject<THREE.Quaternion>;
  /**
   * Utjämnad kompassriktning i grader (0 = norr, medurs), muterad varje
   * sensoravläsning — samma tal som ligger till grund för `quaternionRef`.
   * Exponerad separat (utöver quaternionen) så en konsument som bara
   * behöver den horisontella girriktningen (t.ex. "peka mot närmaste verk"-
   * pilen) slipper räkna ut den ur en full 3D-rotation. `null` innan första
   * avläsningen. Stabil ref-identitet, säker att läsa i en poll-loop utan
   * re-render.
   */
  headingDegRef: React.MutableRefObject<number | null>;
  /**
   * 0..1 mått på hur stabil kompassriktningen (gir) varit över de senaste
   * dryga sekunden — 1 = i princip stillastående, 0 = kraftigt/oregelbundet
   * svängande. Används som en av flera svaga signaler i "Outdoor Confidence
   * Index" (en skakig/svängande kompass tyder ofta på att telefonen just nu
   * rörs runt snarare än hålls stadigt riktad mot himlen).
   */
  headingStabilityRef: React.MutableRefObject<number>;
  /**
   * Kompassens egen felmarginal i grader, om webbläsaren rapporterar den
   * (iOS Safaris `webkitCompassAccuracy` — Android/andra webbläsare saknar
   * en motsvarande standard-API, då förblir denna `null`). Ett litet värde
   * betyder att enheten själv anser sig kalibrerad; ett stort värde
   * (>~15°) eller `-1` (okänt) betyder att kompassen bör kalibreras om
   * (t.ex. genom att röra telefonen i en åtta), oavsett hur stabil
   * `headingStabilityRef` ser ut för stunden — stabilitet mäter bara att
   * riktningen INTE svänger just nu, inte att den pekar rätt. Muterad varje
   * sensoravläsning, säker att läsa i en poll-loop utan re-render. Används
   * av `useArTrackingStability` och sensordebug-panelen.
   */
  headingAccuracyDegRef: React.MutableRefObject<number | null>;
  /**
   * Utjämnad pitch (beta) EFTER horisont-kalibreringsoffseten
   * (`calibrateHorizon`) applicerats — dvs. samma vinkel som faktiskt
   * driver kamerans tilt. Muterad varje sensoravläsning. Rent
   * diagnostiskt/debug-syfte (visar "verklig" pitch i sensordebug-panelen);
   * påverkar inget beteende i sig.
   */
  pitchDegRef: React.MutableRefObject<number | null>;
  /**
   * 0..1 mått på hur stabil pitch/roll (tilt) varit över de senaste dryga
   * sekunden — samma princip som `headingStabilityRef` men för
   * höjd-/rollrörelse ("gyro-stabilitet") istället för gir. En stadigt
   * hållen telefon ger 1; skakning/omvinkling ger ett lägre värde. Muterad
   * varje sensoravläsning. Används av `useArTrackingStability` för att den
   * sammanvägda "AR-stabilitet"-indikatorn ska spegla FLER signaler än bara
   * GPS och kompassgir.
   */
  pitchStabilityRef: React.MutableRefObject<number>;
  /**
   * Den aktuella horisont-kalibreringsoffseten (grader) som
   * `calibrateHorizon` senast satte — 0 om aldrig kalibrerad manuellt.
   * Read-only ur konsumentens perspektiv (skrivs bara internt av
   * `calibrateHorizon`); exponerad för sensordebug-panelen så en testare
   * kan se om/hur mycket horisonten justerats.
   */
  horizonOffsetDegRef: React.MutableRefObject<number>;
  /**
   * Kalibreringen sker i två steg, precis som en riktig kompasskalibrering:
   * "flat" — telefonen ska vridas runt liggande (skärmen ± horisontell),
   * "vertical" — telefonen ska vridas runt stående (skärmen ± vertikal,
   * som när man normalt håller den för AR), "done" — båda klara (eller
   * spårning inte startad). `LoadingSequence.tsx` visar en egen instruktion
   * och grön bock per steg utifrån detta fält.
   */
  calibrationPhase: "flat" | "vertical" | "done";
  /**
   * 0..1 mått på hur stor del av det AKTUELLA kalibreringssteget (se
   * `calibrationPhase`) — uppdelat i `CALIBRATION_TOTAL_SECTORS`
   * riktningssektorer — som användaren faktiskt svept telefonen genom
   * sedan steget startade. Används av `LoadingSequence.tsx` för att visa
   * ett levande kalibreringsförlopp, istället för en blind timer.
   */
  calibrationProgress: number;
  /** Sant när båda kalibreringsstegen (se `calibrationPhase`) är klara. */
  calibrationComplete: boolean;
  /** Börjar (om)räkna kalibreringen från steg 1 ("flat"). */
  startCalibrationTracking: () => void;
  /**
   * Produktkrav 4/5 (juli 2026, "skydd mot frusen heading"): "compass"
   * normalt, "gyro" när den beräknade (norr-refererade) girriktningen
   * bedömts frusen (se `HEADING_STALE_MS`) medan pitch/roll fortsatt
   * ändras — då räknas en tillfällig riktning istället fram ur den råa
   * `alpha`-signalen. Muterad varje sensoravläsning, säker i en poll-loop.
   */
  headingSourceRef: React.MutableRefObject<"compass" | "gyro">;
  /** Reaktiv (state) motsvarighet till `headingSourceRef === "gyro"`, för att styra en synlig varningstext. */
  headingFallbackActive: boolean;
  /** `Date.now()` för senast mottagna orienterings-event, oavsett källa — grund för felsökningsradens "Heading age (ms)". */
  lastOrientationEventAtRef: React.MutableRefObject<number | null>;
  /**
   * Produktkrav (juli 2026, "vakthund mot total sensortystnad"): sant när
   * INGA `deviceorientation(absolute)`-event alls har kommit in på över
   * `ORIENTATION_STALLED_MS`, efter att vi tidigare haft en fix — till
   * skillnad från `headingFallbackActive` (som bara upptäcker att GIRVÄRDET
   * står still MEDAN event fortfarande strömmar in). Denna sortens total
   * sensortystnad observerades i produktion som "pilen och alla verk fryser
   * helt, trots att FPS/AR-stabilitet fortsatte visa bra värden" — just
   * eftersom `headingStabilityRef`/`pitchStabilityRef` annars bara muteras
   * INIFRÅN ett event och därmed fryser kvar på sitt SENASTE (goda) värde.
   * När detta är sant har hooken redan (1) tvingat ner stabilitetsmåtten så
   * `useArTrackingStability` ser en genuin försämring, och (2) försökt
   * återansluta sensorlyssnarna.
   */
  orientationStalled: boolean;
  /**
   * Produktkrav ("Heading updates/sec"): antal `deviceorientation(absolute)`-
   * event mottagna under den senaste sekunden — beräknat i vakthunden
   * (var `ORIENTATION_WATCHDOG_INTERVAL_MS`), inte per event, för att inte
   * trigga en re-render i sensorns fulla 15-60 Hz-takt.
   */
  updatesPerSecond: number;
  /**
   * Produktkrav ("Last update: Nms"): millisekunder sedan senaste
   * mottagna orienterings-event, `null` innan första eventet. Samma
   * underliggande tidsstämpel som `lastOrientationEventAtRef`, men som
   * reaktiv (state) millisekund-ålder redo att visas direkt i UI.
   */
  lastUpdateAgeMs: number | null;
  /**
   * Produktkrav ("värdena fryser trots att event fortsätter komma in"):
   * sant när VARKEN rå girriktning ELLER rå pitch/roll ändrats alls på
   * över `STUCK_VALUES_MS`, trots att event fortfarande strömmar in i
   * normal takt (annars hade `orientationStalled` redan varit sant). Till
   * skillnad från `headingFallbackActive` (som bara gäller giren, med
   * pitch/roll som fortfarande rör sig) — det här är det striktare,
   * tidigare oupptäckta fallet där HELA sensorpipelinen internt kört fast.
   */
  valuesFrozen: boolean;
  /**
   * Produktkrav 5: den EN OCH ENDA funktionen för "vilken riktning gäller
   * just nu" — både pilen och AR-scenens bäringsjämförelser ska anropa
   * denna istället för att var för sig läsa `headingDegRef`, så de aldrig
   * kan råka driva isär.
   */
  getCurrentHeading: () => number | null;
  /**
   * Sjunde kritiska buggrapporten ("Källa: kompass" borde vara riktig
   * sensorfusion): sant så fort minst ett `devicemotion`-event med
   * `rotationRate` faktiskt mottagits — dvs. gyroskopet bidrar just nu till
   * hur snabbt en verklig vridning litas på (se `GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC`
   * nedan), inte bara ren kompass-utjämning. Skiljer sig medvetet från
   * `headingFallbackActive`/`headingSourceRef` ovan, som är ett HELT annat
   * koncept (nödfallback när giren ser ut att ha frusit) — den här flaggan
   * beskriver normal drift, inte ett nödläge.
   */
  motionFusionActive: boolean;
}

// Dödzon: sensorbrus på bråkdelar av en grad ska inte alls påverka
// den utjämnade riktningen — annars "skimrar" objekten även när telefonen
// ligger helt stilla på ett bord.
const DEADZONE_DEG = 0.06;

// Adaptiv utjämning av gir (kompassriktning): magnetometerbrus (särskilt
// inomhus/nära metall) ger ofta enstaka-graders hopp mellan avläsningar
// ÄVEN när telefonen ligger helt stilla — betydligt mer än den tidigare
// fasta tidskonstanten (0.15s) kunde dämpa bort, vilket gjorde att
// vindkraftverken syntes "vandra" trots att telefonen inte rörde sig.
// Lösningen är en tvåhastighets-/adaptiv utjämning (samma princip som ett
// "one euro"-filter): en liten skillnad mellan på varandra följande råa
// avläsningar tolkas som brus och dämpas kraftigt (lång tidskonstant), en
// stor skillnad tolkas som en avsiktlig vridning och släpps igenom snabbt
// (kort tidskonstant) så att AR-vyn ändå känns responsiv när man faktiskt
// vrider på telefonen.
// Produktkrav (juli 2026): verken "hoppade" fortfarande för mycket i sidled
// vid minsta mobilrörelse trots ovanstående adaptiva filter — brusfönstret
// var för smalt (3°) för att fånga den typiska ofrivilliga handskakningen,
// och en enda avläsning över tröskeln räckte för att växla till snabbt
// (0.12s) läge. Två ändringar: (1) bredare brusfönster (5°) och högre
// still-tidskonstant (1.3s) så ofrivillig skakning dämpas kraftigare, (2)
// `HEADING_TURN_CONFIRM_SAMPLES` nedan kräver att flera avläsningar i rad
// pekar åt samma håll innan det räknas som en avsiktlig vridning — en enskild
// spik (t.ex. att man vinklar handleden en aning) faller annars igenom som
// "turn" och ger precis den där sidledshoppet.
const HEADING_NOISE_DELTA_DEG = 5;
const HEADING_TURN_DELTA_DEG = 14;
// Sjunde kritiska buggrapporten ("verken hänger kvar ~1s innan de snäpper
// till rätt läge"): 1.3s still-tidskonstant var satt konservativt för att
// dämpa magnetometerbrus, men gjorde ÄVEN genuina, långsamma-till-måttliga
// vridningar (under `HEADING_TURN_DELTA_DEG`, alltså innan den snabba
// tidskonstanten någonsin nås) märkbart trögare än nödvändigt. Nu när
// `GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC` nedan ger en oberoende, direkt
// bekräftelse av verklig rörelse (se `motionFusionActive`) är det säkrare
// att sänka baslinjen — brusdämpningen tappar inget skydd mot ren
// handskakning (den filtreringen sker fortfarande via bruströskeln och
// `DEADZONE_DEG`), men en riktig, om än långsam, vridning känns nu klart
// snabbare även UTAN gyro (t.ex. på skrivbord/desktop-test där devicemotion
// saknas).
const HEADING_STILL_TAU = 0.7;
const HEADING_TURN_TAU = 0.15;
// Sjunde kritiska buggrapporten (punkt 3, "gyroskopet ska styra snabba
// rörelser, magnetometern bara långsam drift-korrigering"): en uppmätt
// rotationshastighet (grader/sekund, från `devicemotion`s `rotationRate`)
// över denna tröskel är en FYSISKT DIREKT bevis på att telefonen just nu
// verkligen roterar snabbt — till skillnad från att behöva vänta på flera
// bekräftande kompassavläsningar i rad (`HEADING_TURN_CONFIRM_SAMPLES`),
// vilket är precis den fördröjning som gav upphov till "hänger kvar sedan
// snäpper till"-upplevelsen. Vi använder MEDVETET bara magnituden (inte
// tecknet/den integrerade riktningen) av rotationsvektorn — se
// `handleMotion`s kommentar för varför en riktningsintegrerad gyro-heading
// är för riskabel att skeppa utan test på riktig hårdvara. Tröskeln (12°/s)
// är satt klart under vad en avsiktlig, snabb telefonvridning normalt ger
// (typiskt 60-200°/s) men klart över naturligt handskakningsbrus.
const GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC = 12;
// Åttonde kritiska buggrapporten: en MYCKET lägre tröskel än ovan, bara till
// för att avgöra "rör sig telefonen alls just nu" (för `gyroLastActiveAtRef`)
// — inte "är detta en avsiktlig snabb vridning". Måste vara klart över
// sensorbrus i vila (typiskt <1°/s) men klart under en avsiktlig långsam
// vridning, så den fångar även en lugn, kontrollerad rörelse mot pilen.
const GYRO_ACTIVITY_THRESHOLD_DEG_PER_SEC = 3;
// Hur många på varandra följande avläsningar med samma vridningsriktning
// (och delta över bruströskeln) som krävs innan vi litar på att det är en
// verklig, avsiktlig vridning och släpper igenom den snabba tidskonstanten —
// en enstaka avläsning över tröskeln behandlas fortfarande som brus.
const HEADING_TURN_CONFIRM_SAMPLES = 2;
// Om en enskild avläsning antyder en orimligt snabb vridning (fler grader/
// sekund än en människa rimligen kan vrida en telefon) beror det nästan
// alltid på en tillfällig magnetisk störning/sensorglitch, inte en verklig
// rörelse — då hoppar vi över just den avläsningen istället för att låta
// den slå igenom i den utjämnade riktningen.
const MAX_PLAUSIBLE_TURN_RATE_DEG_PER_SEC = 720;
// Juli 2026-fix (fjärde kritiska buggrapporten: "verken hänger kvar på
// skärmen efter en 90°-vridning"): `HEADING_TURN_CONFIRM_SAMPLES` ovan kräver
// två på varandra följande avläsningar över bruströskeln INNAN den snabba
// tidskonstanten släpps igenom — ett medvetet skydd mot enstaka handskaknings-
// spikar. Men en enda avläsning med en SÅ stor delta som denna tröskel kan,
// per definition av vad magnetometerbrus normalt ger (typiskt enstaka grader
// per 15-60Hz-avläsning), aldrig rimligen vara brus — den är alltid en
// verklig, snabb vridning. Utan denna "escape hatch" kunde ett enda sensor-
// event som råkade komma med en ovanligt stor engångsdelta (t.ex. en
// tillfällig event-paus följt av en stor hoppande avläsning) tvinga igenom
// EN extra bekräftelseavläsnings fördröjning innan den snabba tidskonstanten
// slog till — vilket på vissa enheter/OS-versioner med glesare eventtakt kan
// upplevas som att verken "hänger kvar" i över en sekund efter en snabb
// vridning. Nu räknas en så stor delta som direkt bekräftad.
const HEADING_LARGE_JUMP_DEG = 20;

// Juli 2026-fix ("verken glider vid minsta mobilrörelse"): beta/gamma
// (pitch/roll) använde tidigare bara en FAST tidskonstant (0.35s) utan
// bruströskel-baserad adaptivitet eller extremvärdes-filtrering — exakt de
// två knep som redan fixade motsvarande glid-problem för gir (alpha) ovan.
// Små, ofrivilliga handskakningar i pitch/roll slog därför igenom nästan
// direkt och fick verken att kännas som de "flyter" i förhållande till
// bakgrundskameran även när telefonen i praktiken hölls stilla. Samma
// tvåhastighets-/bekräftelsemönster som giren appliceras nu på beta/gamma
// var för sig (egna bekräftelseräknare, då en ren pitch-rörelse inte ska
// triggra rolls snabba läge och vice versa).
const PITCH_ROLL_NOISE_DELTA_DEG = 2.5;
const PITCH_ROLL_TURN_DELTA_DEG = 9;
// Sjunde kritiska buggrapporten: samma resonemang/sänkning som `HEADING_STILL_TAU` ovan.
const PITCH_ROLL_STILL_TAU = 0.55;
const PITCH_ROLL_TURN_TAU = 0.15;
const PITCH_ROLL_TURN_CONFIRM_SAMPLES = 2;
// Samma resonemang som `MAX_PLAUSIBLE_TURN_RATE_DEG_PER_SEC` ovan, men för
// pitch/roll: en enskild avläsning som antyder en orimligt snabb tiltning
// beror nästan alltid på en sensorglitch, inte en verklig rörelse.
const MAX_PLAUSIBLE_TILT_RATE_DEG_PER_SEC = 720;

// Juli 2026-produktkrav 4 ("skydd mot frusen heading"): hur länge (ms) den
// RÅA (ej utjämnade) girriktningen får stå still innan den räknas som
// "frusen" — men bara om pitch/roll UNDER SAMMA TID faktiskt fortsätter
// ändras (annars är det bara en stillastående telefon, inte en frusen
// sensor). 500ms enligt produktkravet.
const HEADING_STALE_MS = 500;

// Produktkrav (juli 2026, "vakthund mot total sensortystnad"): hur länge
// (ms) det får gå utan att ETT ENDA `deviceorientation(absolute)`-event
// alls kommer in innan det räknas som att sensorpipelinen helt tystnat —
// betydligt längre än `HEADING_STALE_MS` (som bara gäller ett stillastående
// GIRVÄRDE medan event fortfarande strömmar in i normal takt, 15-60 Hz) för
// att aldrig falskt trigga vid en enstaka kort hicka.
const ORIENTATION_STALLED_MS = 1200;
// Hur ofta (ms) vakthunden kollar `lastOrientationEventAtRef` — oberoende
// av sensorernas egen (varierande) frekvens.
const ORIENTATION_WATCHDOG_INTERVAL_MS = 400;

// Juli 2026-produktkrav ("kompassen fryser trots att event fortsätter
// komma in"): hur länge (ms) VARKEN den råa girriktningen ELLER rå
// pitch/roll får stå still — oavsett hur ofta event kommer in — innan det
// räknas som att sensorpipelinen internt kört fast (identiska värden i
// varje event). Klart längre än `HEADING_STALE_MS` (som bara handlar om
// giren ensam, medan pitch/roll fortfarande rör sig) eftersom detta ska
// fånga det STRIKTARE fallet att INGENTING alls längre rör sig i rådatan.
const STUCK_VALUES_MS = 1800;
// Hur stor rå förändring (grader) som räknas som "sensorn rör sig alls" —
// satt klart under de vanliga bruströsklarna ovan eftersom vi bara vill
// upptäcka att RÅDATAN uppdateras, inte om ändringen är stor nog för att
// räknas som en avsiktlig vridning.
const RAW_CHANGE_EPSILON_DEG = 0.2;

/**
 * Adaptiv tidskonstant för en linjär (icke-cirkulär) vinkel, enligt samma
 * "liten skillnad => brus (dämpa kraftigt), stor OCH bekräftad skillnad =>
 * avsiktlig rörelse (släpp igenom snabbt)"-princip som giren använder ovan.
 */
function computeAdaptiveLinearTau(
  rawDelta: number,
  turnConfirmCountRef: React.MutableRefObject<number>,
  turnConfirmDirRef: React.MutableRefObject<1 | -1 | null>,
  gyroConfirmsRealMotion = false,
): number {
  const absDelta = Math.abs(rawDelta);
  // Åttonde kritiska buggrapporten (andra omgången, "verken fastnar när man
  // flyttar mobilen"): `gyroConfirmsRealMotion` tidigare kollades bara HÄR
  // INNE, dvs. bara om `absDelta` (skillnaden mellan just DENNA och FÖREGÅENDE
  // rå avläsning) redan råkade nå `PITCH_ROLL_NOISE_DELTA_DEG`. Men vid en
  // normal sensorfrekvens (30-60 Hz) ger även en genuin, måttligt snabb
  // tiltrörelse (10-30°/s) bara någon enstaka grads skillnad PER AVLÄSNING —
  // långt under bruströskeln — så gyroskopets oberoende, redan hastighets-
  // baserade bekräftelse (grader/SEKUND, inte per avläsning) nådde i praktiken
  // aldrig fram, och rörelsen dämpades hela tiden med den långsamma
  // still-tidskonstanten trots att telefonen fysiskt rördes. Nu triggar
  // `gyroConfirmsRealMotion` bekräftelsen OBEROENDE av `absDelta`.
  if (absDelta >= PITCH_ROLL_NOISE_DELTA_DEG || gyroConfirmsRealMotion) {
    const direction: 1 | -1 = rawDelta >= 0 ? 1 : turnConfirmDirRef.current ?? 1;
    // Sjunde kritiska buggrapporten: precis som för giren (se `HEADING_LARGE_JUMP_DEG`),
    // en oberoende gyro-bekräftad verklig rörelse bekräftar direkt, ingen
    // väntan på ytterligare en avläsning i samma riktning.
    if (gyroConfirmsRealMotion) {
      turnConfirmDirRef.current = direction;
      turnConfirmCountRef.current = PITCH_ROLL_TURN_CONFIRM_SAMPLES;
    } else if (turnConfirmDirRef.current === direction) {
      turnConfirmCountRef.current += 1;
    } else {
      turnConfirmDirRef.current = direction;
      turnConfirmCountRef.current = 1;
    }
  } else {
    turnConfirmDirRef.current = null;
    turnConfirmCountRef.current = 0;
  }

  if (turnConfirmCountRef.current >= PITCH_ROLL_TURN_CONFIRM_SAMPLES) {
    // Om gyroskopet bekräftar rörelsen men just DENNA avläsnings `absDelta`
    // ändå är liten (normalt vid hög sensorfrekvens), tvinga fram den
    // snabbaste tidskonstanten direkt istället för att låta `t`-interpolationen
    // (som bygger på `absDelta`) felaktigt landa nära 0/still igen.
    const t = gyroConfirmsRealMotion
      ? 1
      : Math.min(
          1,
          Math.max(0, (absDelta - PITCH_ROLL_NOISE_DELTA_DEG) / (PITCH_ROLL_TURN_DELTA_DEG - PITCH_ROLL_NOISE_DELTA_DEG)),
        );
    return PITCH_ROLL_STILL_TAU + (PITCH_ROLL_TURN_TAU - PITCH_ROLL_STILL_TAU) * t;
  }
  return PITCH_ROLL_STILL_TAU;
}
// Hur stabil (se `headingStabilityRef`) girriktningen måste vara, och hur
// länge sammanhängande, innan kompassen anses ha "rätat in sig" (`hasSettled`).
const SETTLE_STABILITY_THRESHOLD = 0.75;
const SETTLE_STABLE_DURATION_MS = 1200;
// Maxväntetid innan vi ändå släpper igenom — annars skulle en telefon i en
// magnetiskt orolig miljö (t.ex. nära en byggnad med mycket armering)
// aldrig komma förbi väntningen.
const SETTLE_MAX_WAIT_MS = 5000;

// Rotationskalibrering: girriktningens 360° delas i sektorer, och
// användaren måste faktiskt vrida telefonen runt sig genom en majoritet av
// dem (inte bara vagga den lite fram och tillbaka) innan kalibreringen
// räknas som klar. 6 av 12 sektorer (180°, ett halvt varv) kräver en
// genuin vridning utan att kräva ett nästan helt varv — en tidigare högre
// tröskel (8/12) gjorde att kalibreringen ofta tog väldigt lång tid och
// oftast avslutades via `LoadingSequence.tsx`s maxväntetid istället för att
// faktiskt kännas klar, vilket upplevdes som att appen "hänger sig" innan
// den plötsligt kickar igång.
const CALIBRATION_TOTAL_SECTORS = 12;
// Kalibreringen görs nu i två separata steg (liggande, sedan stående) precis
// som instruerat i UI:t — varje steg behöver bara svepa halva sektorantalet
// (5/12, ~150°) eftersom den totala ansträngningen annars blir dubbelt så
// stor jämfört med den tidigare enfasiga kalibreringen (6/12).
const CALIBRATION_REQUIRED_SECTORS_PER_PHASE = 5;
// Hur nära "plant" (skärmen ± horisontell, dvs. beta nära 0° eller 180°)
// respektive "stående" (skärmen ± vertikal, beta nära 90°) telefonens pitch
// måste vara för att en avläsning ska räknas till respektive fas — rundligt
// tilltaget så en normal, inte perfekt, handhållning godtas.
const CALIBRATION_FLAT_BETA_TOLERANCE_DEG = 45;
const CALIBRATION_VERTICAL_BETA_TOLERANCE_DEG = 45;

function isFlatBeta(betaDeg: number): boolean {
  return Math.abs(betaDeg) < CALIBRATION_FLAT_BETA_TOLERANCE_DEG || Math.abs(Math.abs(betaDeg) - 180) < CALIBRATION_FLAT_BETA_TOLERANCE_DEG;
}

function isVerticalBeta(betaDeg: number): boolean {
  return Math.abs(Math.abs(betaDeg) - 90) < CALIBRATION_VERTICAL_BETA_TOLERANCE_DEG;
}

function circularDiffDeg(a: number, b: number): number {
  let diff = a - b;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

/** Tidsbaserad exponentiell utjämningsfaktor (oberoende av sensorns frekvens). */
function timeSmoothingFactor(tau: number, dt: number): number {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-dt / tau);
}

function smoothCircular(prevRef: React.MutableRefObject<number | null>, raw: number, factor: number): number {
  if (prevRef.current === null) {
    prevRef.current = raw;
    return prevRef.current;
  }
  let diff = raw - prevRef.current;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  if (Math.abs(diff) < DEADZONE_DEG) return prevRef.current;
  prevRef.current = (prevRef.current + diff * factor + 360) % 360;
  return prevRef.current;
}

function smoothLinear(prevRef: React.MutableRefObject<number | null>, raw: number, factor: number): number {
  if (prevRef.current === null) {
    prevRef.current = raw;
    return prevRef.current;
  }
  const diff = raw - prevRef.current;
  if (Math.abs(diff) < DEADZONE_DEG) return prevRef.current;
  prevRef.current = prevRef.current + diff * factor;
  return prevRef.current;
}

/**
 * Läser enhetens fullständiga orientering (gir/alpha, pitch/beta, roll/gamma)
 * och räknar fram en THREE.Quaternion som matchar telefonens fysiska riktning
 * i rummet — samma transformation som three.js DeviceOrientationControls
 * använder. Detta gör att kameran roterar korrekt (inklusive tilt uppåt/nedåt
 * och sidlutning) så att AR-objekt upplevs som fast förankrade i verkligheten/
 * horisonten, istället för att bara följa gir (kompassriktning) som tidigare.
 *
 * En kalibreringsfunktion låter användaren låsa "rak horisont" genom att hålla
 * telefonen plant mot horisonten och trycka på en knapp, vilket kompenserar
 * för sensordrift i pitch (beta) mellan olika enheter.
 */
export function useDeviceOrientation(enabled: boolean): DeviceOrientationApi {
  const [supported] = useState(() => typeof window !== "undefined" && "DeviceOrientationEvent" in window);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [hasFix, setHasFix] = useState(false);
  const [hasSettled, setHasSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headingRef = useRef<number | null>(null);
  const headingDegRef = useRef<number | null>(null);
  // Räknar hur många på varandra följande avläsningar som pekat åt SAMMA håll
  // med ett delta över bruströskeln — se `HEADING_TURN_CONFIRM_SAMPLES`.
  // `null` riktning betyder "ingen pågående kandidat".
  const turnConfirmCountRef = useRef(0);
  const turnConfirmDirRef = useRef<1 | -1 | null>(null);
  const betaRef = useRef<number | null>(null);
  const gammaRef = useRef<number | null>(null);
  // Egna bekräftelseräknare för beta/gamma (se `computeAdaptiveLinearTau`
  // ovan) — separata från girens, så en ren pitch-rörelse inte råkar
  // "bekräfta" en rollvridning eller vice versa.
  const betaTurnConfirmCountRef = useRef(0);
  const betaTurnConfirmDirRef = useRef<1 | -1 | null>(null);
  const gammaTurnConfirmCountRef = useRef(0);
  const gammaTurnConfirmDirRef = useRef<1 | -1 | null>(null);
  const betaOffsetRef = useRef(0);
  const screenAngleRef = useRef(0);
  const quaternionRef = useRef(new THREE.Quaternion());
  const hasFixRef = useRef(false);
  const hasFixAtRef = useRef<number | null>(null);
  const hasSettledRef = useRef(false);
  const stableSinceRef = useRef<number | null>(null);
  const lastEventTimeRef = useRef<number | null>(null);
  const headingStabilityRef = useRef(1);
  const headingAccuracyDegRef = useRef<number | null>(null);
  const pitchDegRef = useRef<number | null>(null);
  // Litet rullande fönster av senaste |Δgir|/tidssteg-samples (grader/s) —
  // används bara för att räkna fram `headingStabilityRef`, ingen render.
  const headingDeltaSamplesRef = useRef<number[]>([]);
  // Motsvarande 0..1-mått för pitch/roll (beta+gamma) — "gyro-stabilitet",
  // används av `useArTrackingStability` (produktkrav: "AR-stabilitet" ska
  // vara en genuin sammanvägning, inte bara gir/kompass) för att fånga upp
  // att telefonen faktiskt hålls stadigt i höjd- och rollriktning också,
  // inte bara att kompassriktningen inte svänger.
  const pitchStabilityRef = useRef(1);
  const pitchDeltaSamplesRef = useRef<number[]>([]);
  // Sjunde kritiska buggrapporten (punkt 3, sensorfusion): senaste uppmätta
  // rotationshastighetens MAGNITUD (grader/sekund) från `devicemotion`s
  // `rotationRate`, oberoende av kompassen. Läses av `handleOrientation` för
  // att direkt bekräfta en verklig, snabb vridning (se
  // `GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC`) istället för att vänta på flera
  // bekräftande magnetometeravläsningar i rad.
  const gyroRotationRateDegPerSecRef = useRef(0);
  const [motionFusionActive, setMotionFusionActive] = useState(false);
  const motionFusionActiveRef = useRef(false);
  // Sant så fort ett riktigt `deviceorientationabsolute`-event tagits emot.
  // Många Android-webbläsare skickar BÅDE `deviceorientationabsolute` OCH
  // vanliga `deviceorientation`-event för samma sensoravläsning — men den
  // senares `alpha` är inte alltid kompass-/norr-refererad (kan drifta från
  // en godtycklig startriktning på vissa webbläsare/enheter). Att mata båda
  // källorna genom samma utjämningsfilter ger två konkurrerande
  // "sanningar" om riktningen, vilket upplevs som att AR-objekten svänger/
  // hoppar kraftigt. Så fort en absolut avläsning finns litar vi bara på
  // den (eller andra event som själva flaggar `absolute: true`) och
  // ignorerar icke-absoluta `deviceorientation`-event helt. iOS Safari
  // saknar `deviceorientationabsolute` helt, så där förblir flaggan false
  // och vanliga `deviceorientation`-event (med `webkitCompassHeading`)
  // fortsätter fungera precis som förut.
  const hasAbsoluteFixRef = useRef(false);

  // Juli 2026-produktkrav 4 ("skydd mot frusen heading"): oberoende
  // spårning av NÄR den råa girriktningen respektive rå pitch/roll senast
  // faktiskt ändrades (helt outjämnat) — se `HEADING_STALE_MS`-kommentaren.
  const rawHeadingLastValueRef = useRef<number | null>(null);
  const rawHeadingLastChangeAtRef = useRef<number | null>(null);
  const rawBetaLastValueRef = useRef<number | null>(null);
  const rawGammaLastValueRef = useRef<number | null>(null);
  const rawPitchRollLastChangeAtRef = useRef<number | null>(null);
  // Åttonde kritiska buggrapporten ("pilen roterar inte när telefonen
  // fysiskt vrids"): `headingFrozen`/`allValuesStuck` ovan litade ENDAST på
  // att pitch/roll (`event.beta`/`event.gamma`) förändrades som bevis på att
  // sensor-pipelinen fortfarande lever. Men en ren horisontell vridning
  // (exakt gesten "vrid mobilen mot pilen" som denna app ber om) håller
  // pitch/roll i princip OFÖRÄNDRAT per definition — bara girriktningen
  // (`alpha`) ska ändras. Om just `alpha`-värdet fastnat pga ett OS-/
  // webbläsarfel i sensorfusionen (känt Android-problem, se vakthunden
  // nedan) fanns alltså INGEN korroborerande signal som kunde bevisa att
  // "sensorerna lever men headingen är fast" under precis detta scenario —
  // reservläget till gyroskopet triggades aldrig, och pilen/verken förblev
  // synligt fastfrusna trots att användaren fysiskt vred telefonen.
  // `gyroLastActiveAtRef` spårar separat NÄR gyroskopets egen
  // `rotationRate` (oberoende av kompassens `alpha`) senast visade verklig
  // rörelse över en låg brusnivå (`GYRO_ACTIVITY_THRESHOLD_DEG_PER_SEC`,
  // klart lägre än `GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC` som bara gäller
  // SNABBA vridningar) — och används nedan som ett ALTERNATIVT bevis, sida
  // vid sida med pitch/roll, på att telefonen faktiskt rör sig just nu.
  const gyroLastActiveAtRef = useRef<number | null>(null);
  const headingSourceRef = useRef<"compass" | "gyro">("compass");
  const [headingFallbackActive, setHeadingFallbackActive] = useState(false);
  // Baslinje satt i det ögonblick frysningen upptäcks: reservriktningen
  // räknas som "senast kända goda utjämnade riktning" + hur mycket den råa
  // `alpha`-signalen har vridit sig SEDAN dess — inte ett nytt absolut
  // värde, så det inte blir ett hopp när reservläget slår till.
  const headingFallbackBaselineRef = useRef<{ baselineAlphaHeadingLike: number; baselineHeading: number } | null>(
    null,
  );
  const lastOrientationEventAtRef = useRef<number | null>(null);
  // Se `ORIENTATION_STALLED_MS`-vakthunden i huvudeffekten nedan.
  const orientationStalledRef = useRef(false);
  const [orientationStalled, setOrientationStalled] = useState(false);

  // Juli 2026-produktkrav ("värdena fryser trots att event fortsätter
  // strömma in"): varken `headingFrozen`-skyddet (kräver att pitch/roll
  // FORTSÄTTER ändras) eller `orientationStalled`-vakthunden (kräver att
  // INGA event alls kommer in) upptäcker fallet där webbläsaren/OS:et
  // fortsätter leverera event i normal takt men med IDENTISKA alpha/beta/
  // gamma-värden varje gång — ett känt läge på vissa Android-enheter där
  // sensor-fusionen internt kört fast men händelseloopen inte gjort det.
  // Detta räknas separat här: hur länge (ms) VARKEN den råa girriktningen
  // ELLER rå pitch/roll ändrats alls, oavsett om event strömmar in.
  const updatesPerSecondRef = useRef(0);
  const [updatesPerSecond, setUpdatesPerSecond] = useState(0);
  const recentEventTimestampsRef = useRef<number[]>([]);
  const lastUpdateAtRef = useRef<number | null>(null);
  const [lastUpdateAgeMs, setLastUpdateAgeMs] = useState<number | null>(null);
  const valuesFrozenRef = useRef(false);
  const [valuesFrozen, setValuesFrozen] = useState(false);

  // Tvåstegskalibreringen (se konstanterna ovan): vilka sektorer som svepts
  // i vardera fasen sedan `startCalibrationTracking()` senast anropades.
  // `calibrationPhaseRef` styr vilken fas som just nu räknar avläsningar —
  // "done" betyder att spårning inte är aktiv (antingen inte startad, eller
  // båda faserna redan klara).
  const calibrationPhaseRef = useRef<"flat" | "vertical" | "done">("done");
  const calibrationFlatSectorsRef = useRef<Set<number>>(new Set());
  const calibrationVerticalSectorsRef = useRef<Set<number>>(new Set());
  const [calibrationPhase, setCalibrationPhase] = useState<"flat" | "vertical" | "done">("done");
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationComplete, setCalibrationComplete] = useState(false);

  const startCalibrationTracking = useCallback(() => {
    calibrationFlatSectorsRef.current = new Set();
    calibrationVerticalSectorsRef.current = new Set();
    calibrationPhaseRef.current = "flat";
    setCalibrationPhase("flat");
    setCalibrationProgress(0);
    setCalibrationComplete(false);
  }, []);

  const updateScreenAngle = useCallback(() => {
    const orientationApi = (screen as unknown as { orientation?: { angle: number } }).orientation;
    const legacyOrientation = (window as unknown as { orientation?: number }).orientation;
    screenAngleRef.current = orientationApi?.angle ?? (typeof legacyOrientation === "number" ? legacyOrientation : 0);
  }, []);

  // Sjunde kritiska buggrapporten (punkt 3, "gyroskopet ska styra snabba
  // rörelser, magnetometern bara långsam drift-korrigering"): läser
  // `devicemotion`s `rotationRate` och sparar bara MAGNITUDEN av den fulla
  // rotationsvektorn (grader/sekund) — INTE en integrerad/ackumulerad
  // riktning. Att integrera `rotationRate.alpha` till en absolut girriktning
  // skulle kräva att vi litar på tecken-/axelkonventionen för `rotationRate`,
  // vilken varierar mellan webbläsare/OS-versioner (och kan inte verifieras
  // utan en riktig enhet i den här miljön) — ett teckenfel där skulle få
  // giren att drifta åt FEL håll tills kompassen till slut drar tillbaka den,
  // vilket vore en klart sämre upplevelse än dagens fördröjning. Magnituden
  // är däremot alltid tillförlitlig oavsett tecken/axelkonvention, och ger
  // exakt den signal som behövs: "roterar telefonen verkligen snabbt just
  // nu?" — se `GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC`.
  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    const rr = event.rotationRate;
    if (!rr) return;
    const alpha = rr.alpha ?? 0;
    const beta = rr.beta ?? 0;
    const gamma = rr.gamma ?? 0;
    gyroRotationRateDegPerSecRef.current = Math.sqrt(alpha * alpha + beta * beta + gamma * gamma);
    // Åttonde kritiska buggrapporten: se `gyroLastActiveAtRef`-kommentaren
    // ovanför dess deklaration — detta är den oberoende "telefonen rör sig
    // fysiskt just nu"-signalen som `headingFrozen`/`allValuesStuck` i
    // `handleOrientation` behöver för att kunna upptäcka en fastnad
    // girriktning UNDER EN REN HORISONTELL VRIDNING (då pitch/roll normalt
    // inte ändras alls).
    if (gyroRotationRateDegPerSecRef.current >= GYRO_ACTIVITY_THRESHOLD_DEG_PER_SEC) {
      gyroLastActiveAtRef.current = Date.now();
    }
    if (!motionFusionActiveRef.current) {
      motionFusionActiveRef.current = true;
      setMotionFusionActive(true);
      console.info("[AR][pipeline] Sensorfusion aktiv (gyroskop + kompass)");
    }
  }, []);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const webkitCompassHeading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
    const eventType = (event as unknown as { type?: string }).type;
    const isAbsoluteEvent = eventType === "deviceorientationabsolute" || event.absolute === true;

    if (isAbsoluteEvent) {
      hasAbsoluteFixRef.current = true;
    } else if (hasAbsoluteFixRef.current && typeof webkitCompassHeading !== "number") {
      // Vi har redan en pålitlig absolut/kompass-källa (Android
      // `deviceorientationabsolute`, eller iOS `webkitCompassHeading` som
      // alltid är absolut) — ignorera det här icke-absoluta
      // `deviceorientation`-eventet helt så det inte konkurrerar med och
      // förvränger den utjämnade riktningen.
      return;
    }

    // iOS Safaris egen felmarginal för kompassavläsningen (grader), om den
    // finns — `-1` betyder "okänt" enligt Apples dokumentation och behandlas
    // här som `null` (samma "vi vet inte"-läge som Android, som saknar
    // fältet helt).
    const webkitCompassAccuracy = (event as unknown as { webkitCompassAccuracy?: number }).webkitCompassAccuracy;
    headingAccuracyDegRef.current =
      typeof webkitCompassAccuracy === "number" && webkitCompassAccuracy >= 0 ? webkitCompassAccuracy : null;

    let heading: number | null = null;
    if (typeof webkitCompassHeading === "number") {
      // iOS Safari ger kompassriktning direkt (0 = norr, medurs).
      heading = webkitCompassHeading;
    } else if (event.alpha !== null) {
      // Android: alpha 0 = enheten pekar mot norr, ökar moturs.
      heading = (360 - event.alpha) % 360;
    }

    if (heading === null || event.beta === null || event.gamma === null || Number.isNaN(heading)) return;

    const nowMs = Date.now();
    lastOrientationEventAtRef.current = nowMs;
    lastUpdateAtRef.current = nowMs;

    // Produktkrav ("Heading updates/sec"-felsökningsfält): rullande fönster
    // av senaste event-tidsstämplarna (senaste sekunden) — räknas om till
    // en frekvens i den separata felsökningsvakthunden nedan istället för
    // varje event, för att slippa en `setState` per sensoravläsning
    // (15-60 Hz) och därmed onödiga re-renders.
    const timestamps = recentEventTimestampsRef.current;
    timestamps.push(nowMs);
    while (timestamps.length > 0 && nowMs - timestamps[0] > 1000) timestamps.shift();
    updatesPerSecondRef.current = timestamps.length;

    // Juli 2026-produktkrav 4 ("skydd mot frusen heading"): jämför den RÅA
    // (helt outjämnade) girriktningen och rå beta/gamma mot sina egna
    // föregående råvärden — oberoende av utjämningen nedan, som med AVSIKT
    // dämpar just den här sortens förändring och därför inte kan användas
    // för att avgöra om sensorn faktiskt levererar nya värden. Om giren
    // inte rört sig mer än `RAW_CHANGE_EPSILON_DEG` på över `HEADING_STALE_MS`
    // MEDAN pitch/roll under samma period faktiskt ändrats, tolkas det som
    // att girberäkningen (magnetometerfusionen) tillfälligt "kört fast" —
    // INTE att telefonen ligger stilla (då skulle beta/gamma också stå still).
    const rawHeadingChanged =
      rawHeadingLastValueRef.current === null ||
      Math.abs(circularDiffDeg(heading, rawHeadingLastValueRef.current)) > RAW_CHANGE_EPSILON_DEG;
    if (rawHeadingChanged) {
      rawHeadingLastValueRef.current = heading;
      rawHeadingLastChangeAtRef.current = nowMs;
    }
    const rawPitchRollChanged =
      rawBetaLastValueRef.current === null ||
      rawGammaLastValueRef.current === null ||
      Math.abs(event.beta - rawBetaLastValueRef.current) > RAW_CHANGE_EPSILON_DEG ||
      Math.abs(event.gamma - rawGammaLastValueRef.current) > RAW_CHANGE_EPSILON_DEG;
    if (rawPitchRollChanged) {
      rawBetaLastValueRef.current = event.beta;
      rawGammaLastValueRef.current = event.gamma;
      rawPitchRollLastChangeAtRef.current = nowMs;
    }
    const headingStaleMs = rawHeadingLastChangeAtRef.current === null ? 0 : nowMs - rawHeadingLastChangeAtRef.current;
    const pitchRollFreshMs =
      rawPitchRollLastChangeAtRef.current === null ? Infinity : nowMs - rawPitchRollLastChangeAtRef.current;
    // Åttonde kritiska buggrapporten: se `gyroLastActiveAtRef`-kommentaren.
    // En ren horisontell vridning (den vanligaste "vrid mot pilen"-gesten)
    // håller pitch/roll i princip stilla, så `pitchRollFreshMs` ensam kunde
    // aldrig bevisa "sensorerna lever" i just det fallet — gyroskopets egen
    // rörelsesignal är ett likvärdigt, oberoende bevis på samma sak.
    const gyroFreshMs = gyroLastActiveAtRef.current === null ? Infinity : nowMs - gyroLastActiveAtRef.current;
    const headingFrozen =
      headingStaleMs > HEADING_STALE_MS && (pitchRollFreshMs < HEADING_STALE_MS || gyroFreshMs < HEADING_STALE_MS);

    // Se `STUCK_VALUES_MS`-kommentaren ovan: till skillnad från `headingFrozen`
    // (som kräver att pitch/roll FORTSÄTTER röra sig) upptäcker detta det
    // striktare fallet att VARKEN gir NOCH pitch/roll längre rör sig alls i
    // rådatan, trots att event fortfarande strömmar in (annars hade
    // `orientationStalled`-vakthunden redan fångat det). `event.alpha`
    // fungerar då inte heller som reservkälla (den är också fryst), så det
    // enda den här flaggan kan göra är detsamma som total sensortystnad:
    // signalera nedströms och trigga en lyssnar-återanslutning i vakthunden.
    const pitchRollStaleMs =
      rawPitchRollLastChangeAtRef.current === null ? 0 : nowMs - rawPitchRollLastChangeAtRef.current;
    const gyroStaleMs = gyroLastActiveAtRef.current === null ? 0 : nowMs - gyroLastActiveAtRef.current;
    // Åttonde kritiska buggrapporten: kräv ÄVEN att gyroskopet inte visat
    // någon rörelse nyligen — annars skulle en ren horisontell vridning (där
    // pitch/roll legitimt står still) felaktigt klassas som "allt har
    // fastnat" trots att `headingFrozen` ovan redan hanterar det fallet via
    // reservkällan, och denna striktare flagga bara ska trigga en
    // återanslutning när ABSOLUT ingen rörelse alls syns i rådatan.
    const allValuesStuck =
      headingStaleMs > STUCK_VALUES_MS && pitchRollStaleMs > STUCK_VALUES_MS && gyroStaleMs > STUCK_VALUES_MS;
    if (allValuesStuck !== valuesFrozenRef.current) {
      valuesFrozenRef.current = allValuesStuck;
      setValuesFrozen(allValuesStuck);
    }

    // Reservkälla: den råa `event.alpha`-signalen fortsätter i regel
    // uppdateras av enhetens rotationssensorer även när den beräknade
    // (norr-refererade) girriktningen ovan har "fastnat" — produktkravets
    // "falla tillbaka på deviceorientation alpha/gyro". Konverteras till
    // samma konvention som `heading` ((360-alpha)%360) rent så en cirkulär
    // diff mot baslinjen ger en heading-liknande delta — det spelar ingen
    // roll för en REN deltaberäkning om alpha råkar sakna norr-referens.
    // Nedströms (utjämning/quaternion) används ALLTID `effectiveRawHeading`
    // istället för `heading`, vilket per produktkrav 3 garanterar att
    // varken pilen, debugraden eller AR-scenens kamerarotation någonsin
    // fryser — de bygger alla, indirekt, på samma `headingDegRef`.
    let effectiveRawHeading = heading;
    if (headingFrozen && event.alpha !== null) {
      const alphaHeadingLike = (360 - event.alpha) % 360;
      if (headingFallbackBaselineRef.current === null) {
        headingFallbackBaselineRef.current = {
          baselineAlphaHeadingLike: alphaHeadingLike,
          baselineHeading: headingRef.current ?? heading,
        };
      }
      const baseline = headingFallbackBaselineRef.current;
      effectiveRawHeading =
        (baseline.baselineHeading + circularDiffDeg(alphaHeadingLike, baseline.baselineAlphaHeadingLike) + 360) % 360;
      if (headingSourceRef.current !== "gyro") {
        headingSourceRef.current = "gyro";
        setHeadingFallbackActive(true);
      }
    } else {
      headingFallbackBaselineRef.current = null;
      if (headingSourceRef.current !== "compass") {
        headingSourceRef.current = "compass";
        setHeadingFallbackActive(false);
      }
    }

    // Tvåstegskalibrering: markera vilken sektor den RÅA (ej utjämnade)
    // girriktningen ligger i just nu, men bara medan telefonens pitch (beta)
    // matchar den fas som pågår — "flat" kräver att telefonen faktiskt hålls
    // ± liggande, "vertical" att den hålls ± stående, exakt som texten som
    // visas för användaren instruerar. Vi använder rådata här (inte den
    // nedan utjämnade `smoothedHeading`) eftersom utjämningen med avsikt
    // dämpar snabba rörelser kraftigt — exakt det en riktig vridning
    // producerar — vilket annars skulle göra kalibreringen konstgjort långsam.
    const activePhase = calibrationPhaseRef.current;
    if (activePhase !== "done") {
      const betaMatchesPhase = activePhase === "flat" ? isFlatBeta(event.beta) : isVerticalBeta(event.beta);
      if (betaMatchesPhase) {
        const sector = Math.floor((heading / 360) * CALIBRATION_TOTAL_SECTORS) % CALIBRATION_TOTAL_SECTORS;
        const sectors = activePhase === "flat" ? calibrationFlatSectorsRef.current : calibrationVerticalSectorsRef.current;
        if (!sectors.has(sector)) {
          sectors.add(sector);
          const progress = Math.min(1, sectors.size / CALIBRATION_REQUIRED_SECTORS_PER_PHASE);
          setCalibrationProgress(progress);
          if (sectors.size >= CALIBRATION_REQUIRED_SECTORS_PER_PHASE) {
            if (activePhase === "flat") {
              calibrationPhaseRef.current = "vertical";
              setCalibrationPhase("vertical");
              setCalibrationProgress(0);
            } else {
              calibrationPhaseRef.current = "done";
              setCalibrationPhase("done");
              setCalibrationComplete(true);
            }
          }
        }
      }
    }

    // Tidsbaserad låg-passfiltrering: räknar om utjämningsfaktorn utifrån
    // faktisk tid sedan förra avläsningen, så resultatet blir stabilt även
    // om sensorns frekvens varierar (15–60 Hz beroende på enhet). Pitch/roll
    // (beta/gamma) utjämnas mer (längre tidskonstant) än gir, eftersom
    // vertikal drift stör horisontkänslan mest.
    const now = performance.now();
    const dt = lastEventTimeRef.current === null ? 1 / 60 : Math.min((now - lastEventTimeRef.current) / 1000, 0.5);
    lastEventTimeRef.current = now;

    const prevHeadingRaw = headingRef.current;

    // Hoppa över enstaka avläsningar som antyder en orimligt snabb vridning
    // (se konstantens kommentar ovan) — dessa är nästan alltid en tillfällig
    // magnetisk störning/sensorglitch, inte en verklig rörelse.
    if (prevHeadingRaw !== null && dt > 0) {
      const rawTurnRate = Math.abs(circularDiffDeg(effectiveRawHeading, prevHeadingRaw)) / dt;
      if (rawTurnRate > MAX_PLAUSIBLE_TURN_RATE_DEG_PER_SEC) return;
    }

    // Adaptiv tidskonstant för giren: liten skillnad mot föregående råa
    // avläsning => sannolikt bara magnetometerbrus => dämpa kraftigt (lång
    // tidskonstant); stor skillnad => sannolikt en avsiktlig vridning =>
    // släpp igenom snabbt (kort tidskonstant) — MEN bara efter att flera
    // avläsningar i rad bekräftat samma riktning (se `HEADING_TURN_CONFIRM_SAMPLES`
    // och dess kommentar ovan), annars behandlas även en delta över
    // bruströskeln som brus fram tills den bekräftats.
    let headingTau = HEADING_STILL_TAU;
    if (prevHeadingRaw !== null) {
      const signedDelta = circularDiffDeg(effectiveRawHeading, prevHeadingRaw);
      const rawDelta = Math.abs(signedDelta);
      // Sjunde kritiska buggrapporten: en gyro-bekräftad verklig rotation
      // (se `GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC`) är precis som en stor
      // engångsdelta ett direkt, fysiskt bevis — ingen väntan behövs.
      const gyroConfirmsRealTurn = gyroRotationRateDegPerSecRef.current >= GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC;

      // Åttonde kritiska buggrapporten (andra omgången, "verken fastnar när
      // man flyttar mobilen"): `gyroConfirmsRealTurn` kollades tidigare bara
      // HÄR INNE, dvs. bara om `rawDelta` (skillnaden mot FÖREGÅENDE enskilda
      // avläsning) redan råkade nå `HEADING_NOISE_DELTA_DEG` (5°). Vid en
      // normal sensorfrekvens (30-60 Hz) ger även en genuin, måttlig
      // vridning (t.ex. 20-40°/s, den vanliga "titta åt sidan"-hastigheten)
      // bara en bråkdels grads skillnad PER AVLÄSNING — långt under den
      // tröskeln — så gyroskopets egen, redan hastighetsbaserade bekräftelse
      // (grader/SEKUND, inte per avläsning från `GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC`)
      // nådde i praktiken aldrig fram i det vanligaste fallet. Resultatet:
      // nästan alla vanliga vridningar dämpades hela tiden med den LÅNGSAMMA
      // still-tidskonstanten (`HEADING_STILL_TAU`), vilket kändes som att
      // verken/pilen "fastnade" och släpade efter medan telefonen fysiskt
      // rördes — bara ovanligt HASTIGA vridningar (som gav en tillräckligt
      // stor delta redan per avläsning) kom undan. Nu triggar
      // `gyroConfirmsRealTurn` bekräftelsen OBEROENDE av `rawDelta`.
      if (rawDelta >= HEADING_NOISE_DELTA_DEG || gyroConfirmsRealTurn) {
        const direction: 1 | -1 = signedDelta >= 0 ? 1 : signedDelta < 0 ? -1 : turnConfirmDirRef.current ?? 1;
        if (rawDelta >= HEADING_LARGE_JUMP_DEG || gyroConfirmsRealTurn) {
          // Se `HEADING_LARGE_JUMP_DEG`s kommentar: en så stor engångsdelta
          // räknas som omedelbart bekräftad, ingen väntan på en andra
          // avläsning i samma riktning.
          turnConfirmDirRef.current = direction;
          turnConfirmCountRef.current = HEADING_TURN_CONFIRM_SAMPLES;
        } else if (turnConfirmDirRef.current === direction) {
          turnConfirmCountRef.current += 1;
        } else {
          turnConfirmDirRef.current = direction;
          turnConfirmCountRef.current = 1;
        }
      } else {
        turnConfirmDirRef.current = null;
        turnConfirmCountRef.current = 0;
      }

      if (turnConfirmCountRef.current >= HEADING_TURN_CONFIRM_SAMPLES) {
        // Om gyroskopet bekräftar en verklig vridning men just DENNA
        // avläsnings `rawDelta` ändå är liten (normalt vid hög sensor-
        // frekvens), tvinga fram den snabbaste tidskonstanten direkt istället
        // för att låta `t`-interpolationen (som bygger på `rawDelta`)
        // felaktigt landa nära 0/still igen.
        const t = gyroConfirmsRealTurn
          ? 1
          : Math.min(
              1,
              Math.max(0, (rawDelta - HEADING_NOISE_DELTA_DEG) / (HEADING_TURN_DELTA_DEG - HEADING_NOISE_DELTA_DEG)),
            );
        headingTau = HEADING_STILL_TAU + (HEADING_TURN_TAU - HEADING_STILL_TAU) * t;
      }
    }

    const headingFactor = timeSmoothingFactor(headingTau, dt);

    // Samma extremvärdes-filtrering som giren (se `MAX_PLAUSIBLE_TURN_RATE_DEG_PER_SEC`
    // ovan), men för pitch/roll var för sig: en enskild avläsning som antyder
    // en orimligt snabb tiltning hoppas över helt istället för att slå igenom.
    const prevBetaRaw = betaRef.current;
    const prevGammaRaw = gammaRef.current;
    const betaIsOutlier =
      prevBetaRaw !== null && dt > 0 && Math.abs(event.beta - prevBetaRaw) / dt > MAX_PLAUSIBLE_TILT_RATE_DEG_PER_SEC;
    const gammaIsOutlier =
      prevGammaRaw !== null &&
      dt > 0 &&
      Math.abs(event.gamma - prevGammaRaw) / dt > MAX_PLAUSIBLE_TILT_RATE_DEG_PER_SEC;

    // Sjunde kritiska buggrapporten: samma direkta gyro-bekräftelse som
    // giren använder ovan appliceras här på pitch/roll också.
    const gyroConfirmsRealTiltMotion = gyroRotationRateDegPerSecRef.current >= GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC;
    const betaTau = betaIsOutlier
      ? PITCH_ROLL_STILL_TAU
      : computeAdaptiveLinearTau(
          prevBetaRaw === null ? 0 : event.beta - prevBetaRaw,
          betaTurnConfirmCountRef,
          betaTurnConfirmDirRef,
          gyroConfirmsRealTiltMotion,
        );
    const gammaTau = gammaIsOutlier
      ? PITCH_ROLL_STILL_TAU
      : computeAdaptiveLinearTau(
          prevGammaRaw === null ? 0 : event.gamma - prevGammaRaw,
          gammaTurnConfirmCountRef,
          gammaTurnConfirmDirRef,
          gyroConfirmsRealTiltMotion,
        );
    const betaFactor = betaIsOutlier ? 0 : timeSmoothingFactor(betaTau, dt);
    const gammaFactor = gammaIsOutlier ? 0 : timeSmoothingFactor(gammaTau, dt);

    const prevHeading = headingRef.current;
    const smoothedHeading = smoothCircular(headingRef, effectiveRawHeading, headingFactor);
    const smoothedBeta = smoothLinear(betaRef, event.beta, betaFactor);
    const smoothedGamma = smoothLinear(gammaRef, event.gamma, gammaFactor);

    // Kompass-stabilitet: rullande medel av |Δgir|/s över de senaste ~1.2s.
    // Låg medelhastighet -> stabil (nära 1), hög -> instabil (nära 0).
    if (prevHeading !== null && dt > 0) {
      let delta = smoothedHeading - prevHeading;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const degPerSec = Math.abs(delta) / dt;
      const samples = headingDeltaSamplesRef.current;
      samples.push(degPerSec);
      if (samples.length > 24) samples.shift();
      const avgDegPerSec = samples.reduce((a, b) => a + b, 0) / samples.length;
      // 0°/s -> stabilitet 1; >=20°/s (snabb vridning) -> stabilitet 0.
      headingStabilityRef.current = Math.max(0, 1 - avgDegPerSec / 20);
    }

    // Gyro-/tilt-stabilitet: samma rullande-medel-teknik som ovan, men på
    // den kombinerade pitch+roll-rörelsehastigheten (|Δbeta|+|Δgamma|)/s —
    // fångar upp att TELEFONEN skakar/vinklas om, oberoende av om
    // kompassriktningen (gir) råkar hålla sig stabil under tiden.
    if (prevBetaRaw !== null && prevGammaRaw !== null && dt > 0) {
      const tiltDegPerSec = (Math.abs(smoothedBeta - prevBetaRaw) + Math.abs(smoothedGamma - prevGammaRaw)) / dt;
      const samples = pitchDeltaSamplesRef.current;
      samples.push(tiltDegPerSec);
      if (samples.length > 24) samples.shift();
      const avgTiltDegPerSec = samples.reduce((a, b) => a + b, 0) / samples.length;
      // 0°/s -> stabilitet 1; >=20°/s (kraftig skakning/omvinkling) -> 0.
      pitchStabilityRef.current = Math.max(0, 1 - avgTiltDegPerSec / 20);
    }

    // Konvertera tillbaka till en "alpha" som ger rätt gir i standardformeln.
    const alphaForQuaternion = (360 - smoothedHeading) % 360;
    const adjustedBeta = smoothedBeta - betaOffsetRef.current;

    computeDeviceQuaternion(alphaForQuaternion, adjustedBeta, smoothedGamma, screenAngleRef.current, quaternionRef.current);
    headingDegRef.current = smoothedHeading;
    pitchDegRef.current = adjustedBeta;

    setError(null);
    if (!hasFixRef.current) {
      hasFixRef.current = true;
      hasFixAtRef.current = now;
      setHasFix(true);
    }

    // Se `hasSettled`-dokumentationen i API-typen ovan: vänta tills giren
    // varit stabil en sammanhängande stund (eller en maxväntetid passerat)
    // innan vindkraftverken litar på riktningen och börjar visas.
    if (!hasSettledRef.current && hasFixRef.current) {
      if (headingStabilityRef.current >= SETTLE_STABILITY_THRESHOLD) {
        if (stableSinceRef.current === null) stableSinceRef.current = now;
      } else {
        stableSinceRef.current = null;
      }
      const stableForMs = stableSinceRef.current !== null ? now - stableSinceRef.current : 0;
      const sinceFixMs = hasFixAtRef.current !== null ? now - hasFixAtRef.current : 0;
      if (stableForMs >= SETTLE_STABLE_DURATION_MS || sinceFixMs >= SETTLE_MAX_WAIT_MS) {
        hasSettledRef.current = true;
        setHasSettled(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || !supported) return;

    updateScreenAngle();
    window.addEventListener("orientationchange", updateScreenAngle);
    window.addEventListener("resize", updateScreenAngle);
    window.addEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
    window.addEventListener("deviceorientation", handleOrientation as EventListener, true);

    // Sjunde kritiska buggrapporten (punkt 3, sensorfusion): lyssna alltid på
    // `devicemotion` om webbläsaren stöder det — kräver ingen egen behörighet
    // på de flesta plattformar (bara iOS 13+ Safari kräver ett separat
    // `requestPermission()`-anrop, se `requestPermission` nedan). Om
    // behörighet aldrig beviljas/API:t saknas kommer helt enkelt inga
    // `devicemotion`-event någonsin in, och `motionFusionActive` förblir
    // `false` — exakt samma tysta nedgradering till ren kompassavläsning som
    // redan gällde innan denna fix, ingen extra felhantering behövs här.
    if (typeof window !== "undefined" && "DeviceMotionEvent" in window) {
      window.addEventListener("devicemotion", handleMotion as EventListener);
    }

    // Produktkrav (juli 2026, "vakthund mot total sensortystnad"): den
    // BEFINTLIGA frys-/gyro-fallback-logiken i `handleOrientation` (se
    // `HEADING_STALE_MS`) upptäcker bara att GIRVÄRDET står still MEDAN
    // event fortfarande strömmar in — den har ingen möjlighet att upptäcka
    // att webbläsaren/OS:et helt har SLUTAT leverera event alls (ett känt,
    // sporadiskt fel på bl.a. Android-webbläsare efter skärmlåsning/
    // bakgrund-förgrund-växlingar). I produktion visade sig just detta som
    // "pilen och alla verk fryser helt, trots att FPS/AR-stabilitet
    // fortsatte visa bra värden" — eftersom `headingStabilityRef`/
    // `pitchStabilityRef` bara muteras INIFRÅN ett event och därför frös
    // kvar på sitt SENASTE (goda) värde istället för att spegla att inga
    // nya avläsningar längre kommer in. Denna vakthund kollar
    // `lastOrientationEventAtRef` oberoende av om något event kommer in,
    // och när tystnaden varat längre än `ORIENTATION_STALLED_MS`: (1)
    // tvingar ner stabilitetsmåtten så `useArTrackingStability` genast ser
    // en genuin försämring (istället för ett falskt bra läge), och (2)
    // river och återskapar lyssnarna — ett känt, ofarligt sätt att väcka
    // liv i en "fastnad" sensorpipeline på flera Android-webbläsare.
    const watchdog = window.setInterval(() => {
      const lastAt = lastOrientationEventAtRef.current;
      if (lastAt === null) return;
      const stalled = Date.now() - lastAt > ORIENTATION_STALLED_MS;
      if (stalled && !orientationStalledRef.current) {
        orientationStalledRef.current = true;
        setOrientationStalled(true);
        headingStabilityRef.current = 0;
        pitchStabilityRef.current = 0;
        window.removeEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
        window.removeEventListener("deviceorientation", handleOrientation as EventListener, true);
        window.addEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
        window.addEventListener("deviceorientation", handleOrientation as EventListener, true);
      } else if (!stalled && orientationStalledRef.current) {
        orientationStalledRef.current = false;
        setOrientationStalled(false);
      }

      // Se `STUCK_VALUES_MS`-kommentaren ovan (`allValuesStuck` i
      // `handleOrientation`): samma återanslutningsåtgärd som total
      // sensortystnad, men triggad av att RÅVÄRDENA slutat röra sig trots
      // att event fortfarande kommer in (så `stalled`-grenen ovan aldrig
      // slår till på egen hand för det här fallet).
      if (valuesFrozenRef.current && !stalled) {
        headingStabilityRef.current = 0;
        pitchStabilityRef.current = 0;
        window.removeEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
        window.removeEventListener("deviceorientation", handleOrientation as EventListener, true);
        window.addEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
        window.addEventListener("deviceorientation", handleOrientation as EventListener, true);
      }

      // Felsökningsfält ("Heading updates/sec", "Last update: Nms") —
      // uppdateras här (var 400:e ms) istället för per event, så det inte
      // triggar en re-render 15-60 gånger/sekund.
      setUpdatesPerSecond(updatesPerSecondRef.current);
      setLastUpdateAgeMs(lastUpdateAtRef.current === null ? null : Date.now() - lastUpdateAtRef.current);
    }, ORIENTATION_WATCHDOG_INTERVAL_MS);

    return () => {
      window.clearInterval(watchdog);
      window.removeEventListener("orientationchange", updateScreenAngle);
      window.removeEventListener("resize", updateScreenAngle);
      window.removeEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
      window.removeEventListener("deviceorientation", handleOrientation as EventListener, true);
      window.removeEventListener("devicemotion", handleMotion as EventListener);
    };
  }, [enabled, supported, handleOrientation, handleMotion, updateScreenAngle]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
    if (DOE && typeof DOE.requestPermission === "function") {
      // Sjunde kritiska buggrapporten (sensorfusion): `DeviceMotionEvent`s
      // egen `requestPermission()` (iOS 13+ Safari) måste triggas HÄR,
      // synkront innan vi `await`:ar kompassbehörigheten ovanför — annars
      // hinner den giltiga användargestens fönster stängas innan detta
      // anrop görs (se `.agents/memory/user-gesture-permission-chaining.md`).
      // Precis som `useMotionActivity.ts` är gyroskopet en FÖRSTÄRKNING, inte
      // ett krav: om det nekas eller saknas degraderar hooken tyst till ren
      // kompassavläsning (exakt som innan denna fix), ingen felyta visas.
      const DME = window.DeviceMotionEvent as unknown as DeviceMotionEventiOS;
      const motionPermissionPromise =
        DME && typeof DME.requestPermission === "function" ? DME.requestPermission().catch(() => "denied" as const) : null;

      try {
        const result = await DOE.requestPermission();
        if (motionPermissionPromise) void motionPermissionPromise;
        if (result === "granted") {
          setNeedsPermission(false);
          setError(null);
          return true;
        }
        setError("Åtkomst till kompass nekades.");
        return false;
      } catch {
        setError("Kunde inte begära åtkomst till kompass.");
        return false;
      }
    }
    return true;
  }, []);

  useEffect(() => {
    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
    if (DOE && typeof DOE.requestPermission === "function") {
      setNeedsPermission(true);
    }
  }, []);

  const horizonOffsetDegRef = useRef(0);

  const calibrateHorizon = useCallback(() => {
    // Lås aktuell pitch (beta) som "rak horisont" — kompenserar för
    // sensordrift/bias mellan olika enheter och minskar vertikal drift.
    // Behandlas av `useArTrackingStability` som en "stark referens": den
    // nollställer eventuell ackumulerad drift-osäkerhet direkt, istället för
    // att bara gradvis bygga upp förtroende igen.
    betaOffsetRef.current = (betaRef.current ?? 90) - 90;
    horizonOffsetDegRef.current = betaOffsetRef.current;
  }, []);

  // Produktkrav 5: EN delad funktion för "vilken riktning gäller just nu" —
  // läser bara `headingDegRef`, exakt samma ref som redan driver
  // `alphaForQuaternion`/kamerarotationen, så pilen och AR-scenen (via
  // denna funktion, se `ARScene.tsx`) aldrig kan råka bygga på olika värden.
  const getCurrentHeading = useCallback(() => headingDegRef.current, []);

  return {
    supported,
    needsPermission,
    hasFix,
    hasSettled,
    error,
    requestPermission,
    calibrateHorizon,
    quaternionRef,
    headingDegRef,
    headingStabilityRef,
    headingAccuracyDegRef,
    pitchDegRef,
    pitchStabilityRef,
    horizonOffsetDegRef,
    calibrationPhase,
    calibrationProgress,
    calibrationComplete,
    startCalibrationTracking,
    headingSourceRef,
    headingFallbackActive,
    lastOrientationEventAtRef,
    orientationStalled,
    updatesPerSecond,
    lastUpdateAgeMs,
    valuesFrozen,
    getCurrentHeading,
    motionFusionActive,
  };
}
