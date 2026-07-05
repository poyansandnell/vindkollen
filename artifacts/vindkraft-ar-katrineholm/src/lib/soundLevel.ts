// Uppskattning av upplevd ljudnivå (dBA) från vindkraftverken, baserat på
// GPS-avstånd till varje verk. Detta är EN INFORMATIV UPPSKATTNING — den
// styr INTE volymen på det procedurella vindljudet i appen (se
// `useWindSound.ts`), och ska inte tolkas som en exakt bullerutredning.
//
// Metod:
// 1. Varje verk antas ha en ljudeffektnivå (LWA) på ca 106 dBA — en typisk
//    deklarerad nivå för moderna 6 MW-klass-verk (t.ex. Vestas V162-6.2MW),
//    vilket är den turbintyp de 29 verken är grundade på.
// 2. Ljudnivån vid en given punkt (Lp) beräknas med en förenklad
//    geometrisk spridningsformel för en punktkälla över mark (hemisfärisk
//    spridning), som ofta används vid överslagsberäkningar av
//    vindkraftsbuller: Lp = LWA - 20*log10(d) - 11 (d i meter).
//    Detta ignorerar luftabsorption, terräng, vind och markdämpning —
//    verkliga bullerutredningar är betydligt mer detaljerade.
// 3. Bidrag från flera verk kombineras logaritmiskt (energisummering):
//    L_total = 10*log10(sum(10^(Li/10))).
export const SOUND_POWER_LEVEL_DBA = 106;

/** Ljudnivå (dBA) vid avstånd `distanceM` från ett enskilt verk. */
export function attenuatedLevelDba(distanceM: number): number {
  const d = Math.max(distanceM, 1);
  return SOUND_POWER_LEVEL_DBA - 20 * Math.log10(d) - 11;
}

/** Kombinerar flera ljudnivåer (dBA) logaritmiskt till en total nivå. */
export function combineLevelsDba(levelsDba: number[]): number {
  if (levelsDba.length === 0) return -Infinity;
  const sumEnergy = levelsDba.reduce((sum, l) => sum + 10 ** (l / 10), 0);
  return 10 * Math.log10(sumEnergy);
}

export interface SoundLevelEstimate {
  /** Uppskattad total ljudnivå (dBA) vid användarens position. */
  totalDba: number;
  /** Avstånd (meter) till närmaste verk, eller null om inga verk finns. */
  nearestDistanceM: number | null;
  /** Antal verk som bidrar märkbart till totalnivån (inom ~15 dB av den starkaste källan). */
  contributingCount: number;
}

// Maximal antagen dämpning (dBA) av ljud genom väggar/tak när användaren är
// inomhus, enligt `useSkyDetection`s `outdoorConfidence` (0 = helt inomhus,
// 1 = fritt utomhus). Ungefär i linje med typisk fasaddämpning för lätta
// byggnader/fönster (Sverige, äldre villa ~25–35 dB). Skalas linjärt med
// `1 - outdoorConfidence`, så panelen tonar mjukt mellan lägena istället för
// att hoppa abrupt när dörren/gränsvärdet passeras.
export const MAX_INDOOR_ATTENUATION_DBA = 35;
// Absolut hörbarhetsgolv (dBA) — ett verk räknas bara som "bidragande" om
// dess enskilda, dämpade nivå faktiskt ligger över denna gräns. Behövs
// eftersom en enhetlig dB-dämpning av samtliga verk INTE ändrar deras
// relativa avstånd till varandra (alla sjunker lika mycket), så det tidigare
// "inom 15 dB av starkaste källan"-testet skulle annars ge samma
// `contributingCount` inomhus som utomhus.
const AUDIBILITY_FLOOR_DBA = 20;

/**
 * Beräknar en total dBA-uppskattning från avstånd (meter) till varje verk.
 * Rent informativt — påverkar inte ljuduppspelningen.
 *
 * `outdoorConfidence` (0..1, standard 1) kommer från `useSkyDetection` och
 * representerar hur säkert appen bedömer att användaren befinner sig
 * utomhus. Ju lägre värde (dvs. ju mer sannolikt inomhus), desto mer dämpas
 * varje enskilt verks nivå innan de kombineras — se `MAX_INDOOR_ATTENUATION_DBA`.
 */
export function estimateSoundLevel(distancesM: number[], outdoorConfidence = 1): SoundLevelEstimate {
  if (distancesM.length === 0) {
    return { totalDba: -Infinity, nearestDistanceM: null, contributingCount: 0 };
  }
  const confidence = Math.min(Math.max(outdoorConfidence, 0), 1);
  const indoorAttenuationDba = (1 - confidence) * MAX_INDOOR_ATTENUATION_DBA;
  const levels = distancesM.map((d) => attenuatedLevelDba(d) - indoorAttenuationDba);
  const totalDba = combineLevelsDba(levels);
  const nearestDistanceM = Math.min(...distancesM);
  // "Bidrar märkbart" = ligger inom 15 dB av den starkaste enskilda källan
  // OCH är faktiskt hörbar (över `AUDIBILITY_FLOOR_DBA`) — det senare krävs
  // för att inomhusdämpningen ska minska antalet bidragande verk, inte bara
  // den totala nivån (en enhetlig dB-förskjutning ändrar annars inte vilka
  // verk som ligger inom 15 dB av varandra).
  const strongest = Math.max(...levels);
  const contributingCount = levels.filter((l) => l >= strongest - 15 && l >= AUDIBILITY_FLOOR_DBA).length;
  return { totalDba, nearestDistanceM, contributingCount };
}

export type SoundLevelSeverity = "green" | "yellow" | "orange" | "red";

/** Färgkodning av ljudnivån enligt de fasta tröskelvärdena i produktspecifikationen. */
export function soundLevelSeverity(totalDba: number): SoundLevelSeverity {
  if (!Number.isFinite(totalDba) || totalDba < 30) return "green";
  if (totalDba < 35) return "yellow";
  if (totalDba < 40) return "orange";
  return "red";
}

export const SEVERITY_COLORS: Record<SoundLevelSeverity, { text: string; bg: string; border: string; emoji: string }> = {
  green: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-400/30", emoji: "🟢" },
  yellow: { text: "text-yellow-300", bg: "bg-yellow-500/15", border: "border-yellow-400/30", emoji: "🟡" },
  orange: { text: "text-orange-300", bg: "bg-orange-500/15", border: "border-orange-400/30", emoji: "🟠" },
  red: { text: "text-red-300", bg: "bg-red-500/15", border: "border-red-400/30", emoji: "🔴" },
};

/** Exakt disclaimer-text enligt produktspecifikationen. */
export const SOUND_LEVEL_DISCLAIMER =
  "Denna ljudnivå är en förenklad uppskattning baserad på projektets bullerunderlag och användarens GPS-position. Den ersätter inte en officiell bullerberäkning.";

// Referensnivå (dBA) som anses motsvara "full" spelvolym — ungefär den
// starkaste totala nivån man rimligen kan uppskattas uppleva alldeles intill
// vindkraftverksområdet. Inget exakt vetenskapligt tak, bara den övre änden
// av den skala vindljudets volym mappas mot.
const REFERENCE_MAX_DBA = 55;

/**
 * Omvandlar en beräknad total dBA-nivå (från `estimateSoundLevel`) till en
 * normaliserad uppspelningsvolym 0..1 för det procedurella vindljudet i
 * `useWindSound.ts`. Detta är den ENDA kopplingen mellan den informativa
 * dBA-uppskattningen och den faktiska ljudvolymen — volymen ska kontinuerligt
 * följa den beräknade nivån (låg dBA ⇒ tyst, hög dBA ⇒ högt), inte en separat,
 * fristående av/på-logik.
 *
 * Eftersom `totalDba` redan innehåller ev. manuell "Ljud inne"-dämpning (se
 * `estimateSoundLevel`s `outdoorConfidence`-parameter, som Home.tsx numera
 * styr via den explicita ute/inne-väljaren snarare än kameraheuristiken),
 * faller denna gain naturligt ner mot 0 när användaren valt "Ljud inne" —
 * precis samma siffra som visas i ljudnivåpanelen.
 */
export function dbaToGain(totalDba: number): number {
  if (!Number.isFinite(totalDba)) return 0;
  // Juli 2026-fix ("den visade dBA-nivån matchar inte hur högt det låter"):
  // en tidigare version normaliserade linjärt mellan golv/tak och sedan
  // KVADRERADE resultatet (`clamped * clamped`) — en godtycklig kurva, inte
  // en verklig dB->amplitud-omvandling. Det gav en volym som INTE svarade
  // logaritmiskt/kontinuerligt på dBA-siffran man faktiskt ser i panelen:
  // två lika stora dBA-steg gav olika stora hörbara volymskillnader beroende
  // på var i intervallet man befann sig.
  //
  // Den fysikaliskt korrekta relationen mellan en nivå i dB och en linjär
  // amplitud/gain är EXPONENTIELL: var -20 dB halverar amplituden en tiondel
  // (10^(-20/20) = 0.1), och varje lika stort dB-steg ger alltid samma
  // *förhållande* i upplevd volym (ungefär en fördubbling av upplevd
  // ljudstyrka per +10 dB, i linje med hur mänsklig hörsel fungerar) —
  // kontinuerligt, utan hopp, och konsekvent med `estimateSoundLevel`s redan
  // logaritmiska (20*log10(d)) avstånds-/kombineringsformel.
  if (totalDba <= AUDIBILITY_FLOOR_DBA) return 0;
  const gain = 10 ** ((totalDba - REFERENCE_MAX_DBA) / 20);
  return Math.min(Math.max(gain, 0), 1);
}

/**
 * Applicerar den manuella "Ljud ute"/"Ljud inne"-dämpningen som ett
 * OMEDELBART, icke-utjämnat sista steg ovanpå en (ev. GPS-jitter-utjämnad)
 * dBA-nivå. Måste INTE gå via `useSmoothedDba` — annars dröjer det upp till
 * hela utjämningsfönstret (flera sekunder) innan en växling av väljaren
 * faktiskt hörs i det spelade ljudet, vilket var den rapporterade buggen
 * ("Ljud inne" uppdaterade bara texten/panelen, inte ljudmotorn).
 *
 * Används ENDAST för den visade dBA-siffran i panelen — se
 * `indoorGainMultiplier`/`applyIndoorGain` nedan för hur den faktiska
 * ljudvolymen dämpas. De två måste hållas separata (se motivering där) men
 * representerar matematiskt samma -35 dB-dämpning.
 */
export function applyIndoorAttenuation(totalDba: number, indoor: boolean): number {
  if (!Number.isFinite(totalDba)) return totalDba;
  return indoor ? totalDba - MAX_INDOOR_ATTENUATION_DBA : totalDba;
}

/**
 * Korrekt dB→linjär-omvandling av `MAX_INDOOR_ATTENUATION_DBA` (en minskning
 * på X dB motsvarar en multiplikation med 10^(-X/20) av den linjära
 * amplituden/gainen).
 *
 * VIKTIGT: den faktiska ljudvolymen får INTE räknas ut genom att först dra av
 * `MAX_INDOOR_ATTENUATION_DBA` från totalDba och sedan köra resultatet genom
 * `dbaToGain` (dvs. `dbaToGain(applyIndoorAttenuation(totalDba, true))`).
 * `dbaToGain` normaliserar linjärt mellan `AUDIBILITY_FLOOR_DBA` (20) och
 * `REFERENCE_MAX_DBA` (55) och klipper allt under golvet till exakt 0 — och
 * eftersom `MAX_INDOOR_ATTENUATION_DBA` (35) nästan motsvarar HELA det
 * spannet, klipptes "Ljud inne"-volymen till exakt 0 för praktiskt taget
 * alla realistiska utomhusnivåer (~20–55 dBA), OAVSETT hur hög den
 * ursprungliga utomhusnivån faktiskt var. När den beräknade utomhusnivån
 * redan låg nära golvet (vanligt på de faktiska GPS-avstånden i
 * Katrineholm, flera km från Länsterberget) var resultatet redan nästan 0,
 * så växlingen till "Ljud inne" gav ingen hörbar skillnad alls — precis den
 * rapporterade buggen ("volymen ändras inte alls").
 *
 * Genom att i stället multiplicera den REDAN beräknade (icke-dämpade)
 * utomhusgainen direkt med denna faktor garanteras en konstant, hörbar,
 * proportionell sänkning (~-35 dB) oavsett hur tyst eller hög
 * utomhusnivån råkar vara — aldrig beroende av var den ligger relativt
 * `dbaToGain`s golv/tak.
 */
export const INDOOR_SOUND_GAIN_MULTIPLIER = 10 ** (-MAX_INDOOR_ATTENUATION_DBA / 20);

/** Applicerar `INDOOR_SOUND_GAIN_MULTIPLIER` direkt på en redan beräknad linjär gain (0..1). */
export function applyIndoorGain(gain: number, indoor: boolean): number {
  return indoor ? gain * INDOOR_SOUND_GAIN_MULTIPLIER : gain;
}
