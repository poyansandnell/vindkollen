import { useEffect, useRef, useState } from "react";

interface WindNodes {
  windSource: AudioBufferSourceNode;
  windGain: GainNode;
  whooshSource: AudioBufferSourceNode;
  whooshFilter: BiquadFilterNode;
  whooshSwishGain: GainNode;
  whooshGain: GainNode;
  lfo: OscillatorNode;
  lfoShaper: WaveShaperNode;
  lfoGain: GainNode;
  whoosh2Source: AudioBufferSourceNode;
  whoosh2Filter: BiquadFilterNode;
  whoosh2SwishGain: GainNode;
  whoosh2Gain: GainNode;
  lfo2: OscillatorNode;
  lfo2Shaper: WaveShaperNode;
  lfo2Gain: GainNode;
  rumbleOsc: OscillatorNode;
  rumbleOsc2: OscillatorNode;
  rumbleGain: GainNode;
  directionLfo: OscillatorNode;
  directionGain: GainNode;
  masterGain: GainNode;
  makeupGain: GainNode;
  compressor: DynamicsCompressorNode;
  limiter: WaveShaperNode;
  streamDestination: MediaStreamAudioDestinationNode;
}

// Maxvolymen håller ljudet tydligt kraftigare nära tornen, ungefär som
// verkens bullerutredning anger (ca 35–40 dBA ekvivalent nivå vid närmaste
// bostad, som ett tyst kylskåpssus). Volymen skalas LINJÄRT 0..MAX från en
// gemensam, utjämnad "master-volym" (0..1) — som i sin tur styrs helt av
// `updateProximity`s `targetVolume`-parameter, dvs. DIREKT av den beräknade
// dBA-nivån via `lib/soundLevel.ts`s `dbaToVolume(totalDba)` (se
// `Home.tsx`), inte av en egen fristående avståndskurva. Ingen hörbar
// bottenvolym vid `targetVolume=0` (t.ex. "Ljud inne") — annars matchar inte
// den faktiska volymen den nästan-noll dBA-siffran som visas i panelen. OBS:
// webbljud kan ändå inte återge en fysisk dB-nivå exakt (beror på telefonens
// högtalare/volym) — dBA-uppskattningen är informativ, men den här
// kopplingen gör att volymen ändå kontinuerligt FÖLJER den.
//
// Juli 2026-produktkrav ("volymen måste räknas om minst 10 ggr/sekund, inte
// bara när React råkar re-rendera"): `updateProximity` sätter numera bara en
// ref (`targetVolumeRef`) — den faktiska utjämningen/tillämpningen på
// ljudnoderna sker i en EGEN, oberoende `setInterval`-loop (`AUDIO_TICK_MS`,
// se `startAudioLoop` nedan) som körs oavsett hur ofta anroparen (Home.tsx)
// själv re-renderar. Utjämningen är ett enkelt exponentiellt glidande
// medelvärde (EMA): `smoothed = smoothed*0.85 + target*0.15` per tick,
// tillämpat direkt på `GainNode.gain.value` — INTE Web Audio-schemalagda
// `setTargetAtTime`-övertoningar (de har en fast, långsammare tidskonstant
// och uppdateras bara när metoden anropas, inte kontinuerligt).
//
// Juli 2026-fix (produktfeedback: "minska ljudet från 300% påslag till
// naturligt ljud exakt enligt den decibel som visas i appen"): de fyra
// per-lagrets MAX-konstanter summerade till 3,25 (AMBIENCE 0,78 + WHOOSH
// 1,25 + WHOOSH2 0,80 + RUMBLE 0,42), vilket innebar att signalen in till
// masterGain var ca 3× högre än vad `dbaToVolume`s 0..1-utdata representerar
// — dvs. ett konstgjort ~300%-påslag ovanpå den dBA-kalibrerade kurvan. Nu
// är konstanterna normaliserade så att deras summa är ≈ 1,0, vilket gör att
// den kombinerade nivån vid `targetVolume=1` producerar ≈ 1,0-amplitud
// in i masterbussen — och vid t.ex. 30 dBA (targetVolume ≈ 0,02) hörs
// ljudet proportionellt tyst, precis som siffran indikerar.
// Kompressorn och makeupGain (1,1) finns kvar som säkerhetsnät mot
// klippning, men de boostear inte längre medvetet.
const AMBIENCE_MAX = 0.25;
const WHOOSH_MAX = 0.40;
const WHOOSH2_MAX = 0.25;
const RUMBLE_MAX = 0.10;

// ~20 Hz — klart över produktkravets "minst 10 ggr/sekund", med marginal så
// utjämningen känns kontinuerlig snarare än stegvis.
const AUDIO_TICK_MS = 50;
// Se `smoothed = smoothed*0.85 + target*0.15` i produktkravet — dvs. den nya
// målvolymen väger in med 15% per tick, den tidigare utjämnade volymen med 85%.
const VOLUME_EMA_NEW_WEIGHT = 0.15;

/**
 * Genererar ett kraftigt, uppslukande vindkraftsljud helt proceduralt med Web
 * Audio API — inga externa ljudfiler behövs:
 *
 * - Bred, kraftfull, kontinuerlig vindsvep-ambience (filtrerat brus).
 * - Två oberoende bladsvisch-lager med olika takt/frekvens, för att låta som
 *   flera verk (t.ex. flera i närheten) som kombineras till ett tätare,
 *   kraftigare ljudlandskap snarare än ett enda rent tonalt mönster.
 * - Dubbla lågfrekventa mullr-oscillatorer (grundton + oktav) för fysisk tyngd.
 * - En långsam "vindriktnings"-LFO som moduleras in på master-volymen, så att
 *   ljudet naturligt sväller och avtar lite över tid — som om vindriktningen
 *   ändras — utan att kännas mekaniskt konstant.
 * - Volymen följer kontinuerligt den beräknade dBA-nivån (se `updateProximity`
 *   och `lib/soundLevel.ts`s `dbaToVolume`) — högre beräknad nivå (närmare verk,
 *   fler bidragande verk, "Ljud ute" valt) ⇒ högre volym.
 * - En hård DynamicsCompressorNode + makeup-gain ger hög upplevd ljudstyrka,
 *   och en avslutande mjuk klippningskurva (WaveShaper) garanterar att inget
 *   digitalt klipper eller distorderar oavsett hur högt insignalen drivs.
 *
 * iPhone Safari-specifikt: den slutliga signalen skickas INTE direkt till
 * `ctx.destination`, utan till en `MediaStreamAudioDestinationNode` som
 * spelas upp via ett dolt `<audio>`-element. Rå `AudioContext.destination`-
 * uppspelning kan på iOS ibland hamna i "recording/voice"-ljudkategorin
 * (rutas till telefonens LUR-högtalare istället för huvudhögtalaren) —
 * genom att spela upp via ett riktigt `<audio>`-element tvingas Safari att
 * använda den vanliga mediauppspelningsrutten (huvudhögtalaren). Ingen
 * mikrofon/inspelning används någonstans i appen, vilket annars är den
 * vanligaste orsaken till att iOS växlar ljudkategori.
 *
 * AudioContext återskapas varje gång användaren trycker på "Ljud PÅ" (istället
 * för att återanvända en gammal kontext) — detta ger en garanterat ren
 * ljudsession på iOS Safari, som annars kan fastna i fel uppspelningsläge om
 * kameran startats/stoppats emellanåt. `toggle()` anropas alltid direkt från
 * en knapptryckning, vilket är ett giltigt tillfälle att både skapa och
 * återuppta/låsa upp AudioContext permanent.
 */
export function useWindSound() {
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<WindNodes | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Senaste kända målvolym (0..1, redan `dbaToVolume`+ev. inomhus-multiplicerad
  // av Home.tsx) och medel-RPM — skrivs av `updateProximity`, läses av den
  // oberoende `AUDIO_TICK_MS`-loopen nedan. Refs (inte state) eftersom loopen
  // körs helt utanför Reacts renderingscykel.
  const targetVolumeRef = useRef(0);
  const avgRpmRef = useRef(0);
  // Den faktiska, EMA-utjämnade volymen som just nu är applicerad på
  // ljudnoderna — exponeras för debug-panelen (produktkrav: visa både
  // mål- och faktisk volym) och dubblar som "senaste värdet" utjämningen
  // fortsätter räkna ifrån mellan ticks.
  const actualVolumeRef = useRef(0);
  const audioLoopIdRef = useRef<number | null>(null);

  function stopAudioLoop() {
    if (audioLoopIdRef.current !== null) {
      window.clearInterval(audioLoopIdRef.current);
      audioLoopIdRef.current = null;
    }
  }

  /**
   * Den oberoende, högfrekventa (`AUDIO_TICK_MS`, ~20Hz) uppdateringsloopen
   * som faktiskt applicerar volymen på ljudnoderna — se motivering i den
   * stora kommentaren ovan `AMBIENCE_MAX`. Körs kontinuerligt medan ljudet
   * spelas, oavsett hur ofta `updateProximity` själv anropas (position/dBA
   * uppdateras normalt i GPS-takt, klart under 10Hz — men SJÄLVA
   * utjämnings-/tillämpningssteget måste ändå räknas om minst 10 ggr/sekund
   * enligt produktkravet, så volymen känns kontinuerlig snarare än stegvis).
   */
  function startAudioLoop() {
    stopAudioLoop();
    audioLoopIdRef.current = window.setInterval(() => {
      const nodes = nodesRef.current;
      if (!nodes) return;

      const target = Math.min(Math.max(targetVolumeRef.current, 0), 1);
      // Exakt produktkravsformeln: smoothed = smoothed*0.85 + target*0.15.
      actualVolumeRef.current =
        actualVolumeRef.current * (1 - VOLUME_EMA_NEW_WEIGHT) + target * VOLUME_EMA_NEW_WEIGHT;
      const volume = actualVolumeRef.current;

      nodes.windGain.gain.value = volume * AMBIENCE_MAX;
      nodes.whooshGain.gain.value = volume * WHOOSH_MAX;
      nodes.whoosh2Gain.gain.value = volume * WHOOSH2_MAX;
      nodes.rumbleGain.gain.value = volume * RUMBLE_MAX;

      // Bladpassage: 3 blad per varv, omvandlat till Hz och dämpat till ett
      // hörbart intervall — se motsvarande kommentar i den tidigare
      // `updateProximity`. Lager 2 körs i en lätt förskjuten takt.
      const bladePassHz = (Math.max(avgRpmRef.current, 1) / 60) * 3;
      const clampedHz = Math.min(Math.max(bladePassHz, 0.3), 2.2);
      nodes.lfo.frequency.value = clampedHz;
      nodes.lfo2.frequency.value = clampedHz * 0.87;
    }, AUDIO_TICK_MS);
  }

  // Pausa/återuppta AudioContext när appen bakgrundas eller stängs (t.ex. iOS
  // hemknapp, byte av app). Förhindrar att ljud fortsätter spela när appen
  // inte är synlig.
  useEffect(() => {
    const handleVisibility = () => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      if (document.hidden) {
        void ctx.suspend();
      } else if (ctx.state === "suspended") {
        void ctx.resume();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    return () => {
      stopAudioLoop();
      const nodes = nodesRef.current;
      try {
        nodes?.windSource.stop();
        nodes?.whooshSource.stop();
        nodes?.whoosh2Source.stop();
        nodes?.lfo.stop();
        nodes?.lfo2.stop();
        nodes?.rumbleOsc.stop();
        nodes?.rumbleOsc2.stop();
        nodes?.directionLfo.stop();
      } catch {
        // redan stoppad — ignorera.
      }
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.srcObject = null;
        audioElRef.current.remove();
        audioElRef.current = null;
      }
      ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  function makeNoiseBuffer(ctx: AudioContext, brightness: number): AudioBuffer {
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + brightness * white) / (1 + brightness);
      data[i] = lastOut * 6;
    }
    return buffer;
  }

  /**
   * Mjuk mättnadskurva (tanh) som sista säkerhetsnät — klämmer signalen
   * naturligt mot ±1 istället för att hårt klippa/distordera, oavsett hur
   * mycket gain som drivs in i den tidigare kedjan.
   */
  function makeSoftClipCurve(): Float32Array {
    const n = 4096;
    const curve = new Float32Array(n);
    const k = 1.6;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  /**
   * Formar en sinus-LFO (-1..1) till en toppig, unipolär pulskurva (0..1)
   * som används för att skapa ett riktigt "bladsvisch" istället för en mjuk,
   * vaglik vibrato: snabb stigning mot en kort topp när ett blad passerar,
   * följt av en längre, tystare dal innan nästa passage — samma karaktär som
   * riktiga vindkraftverk har. Högre `sharpness` ger kortare, tydligare
   * "whoosh"-toppar och längre tystnad däremellan.
   */
  function makeSwishPulseCurve(sharpness: number): Float32Array {
    const n = 4096;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const unipolar = (x + 1) / 2;
      curve[i] = Math.pow(unipolar, sharpness);
    }
    return curve;
  }

  function stopAllNodes(nodes: WindNodes) {
    try {
      nodes.windSource.stop();
      nodes.whooshSource.stop();
      nodes.whoosh2Source.stop();
      nodes.lfo.stop();
      nodes.lfo2.stop();
      nodes.rumbleOsc.stop();
      nodes.rumbleOsc2.stop();
      nodes.directionLfo.stop();
    } catch {
      // ignorera om redan stoppad.
    }
  }

  async function toggle() {
    if (playing) {
      const nodes = nodesRef.current;
      const ctx = ctxRef.current;
      if (nodes && ctx) {
        stopAudioLoop();
        nodes.masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        setTimeout(() => {
          stopAllNodes(nodes);
          nodesRef.current = null;
          if (audioElRef.current) {
            audioElRef.current.pause();
          }
        }, 500);
      }
      setPlaying(false);
      return;
    }

    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      // Web Audio saknas i den här webbläsaren — misslyckas tyst utan krasch.
      return;
    }

    // Skapar alltid en ny AudioContext vid start (se motivering i
    // jsdoc-kommentaren ovan) för en garanterat ren ljudsession på iOS Safari.
    if (ctxRef.current) {
      try {
        await ctxRef.current.close();
      } catch {
        // ignorera.
      }
      ctxRef.current = null;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioContextCtor();
    } catch {
      return;
    }
    ctxRef.current = ctx;

    // iOS Safari (och Chrome autoplay-policy) startar AudioContext i
    // "suspended"-läge tills den återupptas inom en användarinteraktion.
    // Eftersom toggle() alltid anropas direkt från en knapptryckning är
    // detta ett giltigt tillfälle att låsa upp ljudet permanent.
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // Om resume misslyckas fortsätter vi ändå — noderna kopplas upp och
        // spelas när/om kontexten senare tillåts starta.
      }
    }

    // Masterbuss: signalkedjan är masterGain -> compressor (hård, låg
    // tröskel) -> makeupGain (lyfter tillbaka upplevd volym) -> limiter
    // (mjuk klippningskurva, sista säkerhetsnätet) -> streamDestination,
    // som spelas upp via ett dolt <audio>-element (se `startAudioElement`
    // nedan) istället för direkt till `ctx.destination`, för att garantera
    // huvudhögtalar-routing på iPhone.
    // Juli 2026-fix ("ljudet låter lika högt oavsett avstånd"): den
    // tidigare hårda kompressorn (tröskel -26dB, ratio 18:1) + en 270%
    // makeup-gain platt-trycker praktiskt taget hela dynamiken INNAN
    // `updateProximity`s dBA-styrda volym ens hinner uttrycka sig — en tyst
    // (låg dBA) signal komprimerades upp mot nästan samma nivå som en högre,
    // så avståndet till verken slutade höras. Kompressorn är nu bara ett
    // säkerhetsnät mot digital klippning (mjuk knä, låg ratio), och
    // makeup-gainen kompenserar bara för kompressorns egen, nu blygsamma,
    // nivåsänkning — ingen konstgjord volymboost ovanpå den riktiga
    // dBA-styrda gainen.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;

    const makeupGain = ctx.createGain();
    makeupGain.gain.value = 1.1;

    const limiter = ctx.createWaveShaper();
    limiter.curve = makeSoftClipCurve() as Float32Array<ArrayBuffer>;
    limiter.oversample = "4x";

    const streamDestination = ctx.createMediaStreamDestination();

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(limiter);
    limiter.connect(streamDestination);
    masterGain.gain.setTargetAtTime(1, ctx.currentTime, 0.6);

    // Dolt <audio>-element som faktiskt spelar upp ljudet. Att gå via ett
    // riktigt medieelement (istället för `ctx.destination`) är den kända
    // lösningen för att tvinga iOS Safari att använda huvudhögtalaren i
    // stället för telefonlur-högtalaren, särskilt i appar som även använder
    // kameran. Ingen ljudinspelning/mikrofon används här.
    let audioEl = audioElRef.current;
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.setAttribute("playsinline", "true");
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;
    }
    audioEl.srcObject = streamDestination.stream;
    audioEl.muted = false;
    audioEl.volume = 1;
    try {
      await audioEl.play();
    } catch {
      // Om uppspelning nekas fortsätter ljudgrafen ändå att köra —
      // användaren kan behöva trycka igen, men inget kraschar.
    }

    // Långsam "vindriktnings"-variation — moduleras in på hela masterbussen
    // så att den totala volymen sväller/avtar naturligt över tid, som om
    // vindriktningen relativt verken ändras något.
    const directionLfo = ctx.createOscillator();
    directionLfo.type = "sine";
    directionLfo.frequency.value = 0.045;
    const directionGain = ctx.createGain();
    directionGain.gain.value = 0.12;
    directionLfo.connect(directionGain);
    directionGain.connect(masterGain.gain);
    directionLfo.start();

    // Vindljud — bredbandigt, kraftfullt brusigt ambientljud.
    const windSource = ctx.createBufferSource();
    windSource.buffer = makeNoiseBuffer(ctx, 0.02);
    windSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGain);
    windSource.start();
    // Startar tyst (0) — den riktiga volymen sätts av `updateProximity`
    // strax efter, direkt från den beräknade dBA-nivån. Ingen fast
    // bottenvolym här, annars hörs ett kort "hopp" innan den första riktiga
    // uppdateringen hinner köra, och "Ljud inne" skulle aldrig bli helt tyst.
    windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);

    // Bladsvisch, lager 1 — smalare, ljusare brus. Rytmen kommer nu från en
    // riktig tremolo-kedja (whooshSwishGain) istället för att bara lägga en
    // mjuk sinus ovanpå volymen: LFO:n formas via en WaveShaper till en
    // toppig pulskurva (snabb "whoosh", längre tystnad däremellan — precis
    // som en riktig bladpassage låter) som sedan multiplicerar signalen.
    // whooshGain sitter kvar oförändrad efter och styr den övergripande
    // avståndsberoende volymen (se updateProximity), så pulsformen förblir
    // lika tydlig oavsett hur nära/långt bort verken är.
    const whooshSource = ctx.createBufferSource();
    whooshSource.buffer = makeNoiseBuffer(ctx, 0.1);
    whooshSource.loop = true;
    const whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = "bandpass";
    whooshFilter.frequency.value = 900;
    whooshFilter.Q.value = 1.1;
    const whooshLowpass = ctx.createBiquadFilter();
    whooshLowpass.type = "lowpass";
    whooshLowpass.frequency.value = 2600;
    const whooshSwishGain = ctx.createGain();
    whooshSwishGain.gain.value = 0.16;
    const whooshGain = ctx.createGain();
    whooshGain.gain.value = 0.08;
    whooshSource.connect(whooshFilter);
    whooshFilter.connect(whooshLowpass);
    whooshLowpass.connect(whooshSwishGain);
    whooshSwishGain.connect(whooshGain);
    whooshGain.connect(masterGain);
    whooshSource.start();

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.6;
    const lfoShaper = ctx.createWaveShaper();
    lfoShaper.curve = makeSwishPulseCurve(2.4) as Float32Array<ArrayBuffer>;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.82;
    lfo.connect(lfoShaper);
    lfoShaper.connect(lfoGain);
    lfoGain.connect(whooshSwishGain.gain);
    lfo.start();

    // Se motsvarande kommentar vid windGain ovan — startar tyst, riktig
    // volym sätts av `updateProximity`.
    whooshGain.gain.setTargetAtTime(0, ctx.currentTime, 0.8);

    // Bladsvisch, lager 2 — ett andra, oberoende svischlager med en annan
    // filterkaraktär, egen (lätt förskjuten) takt och en något mjukare
    // pulsform, för att simulera flera verk vars bladpassager inte är
    // perfekt synkroniserade — ett tätare, mer verklighetstroget och
    // kraftfullare kombinerat ljudlandskap istället för ett enda,
    // uppenbart repetitivt mönster.
    const whoosh2Source = ctx.createBufferSource();
    whoosh2Source.buffer = makeNoiseBuffer(ctx, 0.14);
    whoosh2Source.loop = true;
    const whoosh2Filter = ctx.createBiquadFilter();
    whoosh2Filter.type = "bandpass";
    whoosh2Filter.frequency.value = 650;
    whoosh2Filter.Q.value = 0.95;
    const whoosh2SwishGain = ctx.createGain();
    whoosh2SwishGain.gain.value = 0.2;
    const whoosh2Gain = ctx.createGain();
    whoosh2Gain.gain.value = 0.06;
    whoosh2Source.connect(whoosh2Filter);
    whoosh2Filter.connect(whoosh2SwishGain);
    whoosh2SwishGain.connect(whoosh2Gain);
    whoosh2Gain.connect(masterGain);
    whoosh2Source.start();

    const lfo2 = ctx.createOscillator();
    lfo2.type = "sine";
    lfo2.frequency.value = 0.52;
    const lfo2Shaper = ctx.createWaveShaper();
    lfo2Shaper.curve = makeSwishPulseCurve(1.9) as Float32Array<ArrayBuffer>;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.75;
    lfo2.connect(lfo2Shaper);
    lfo2Shaper.connect(lfo2Gain);
    lfo2Gain.connect(whoosh2SwishGain.gain);
    lfo2.start();

    // Se motsvarande kommentar vid windGain ovan — startar tyst, riktig
    // volym sätts av `updateProximity`.
    whoosh2Gain.gain.setTargetAtTime(0, ctx.currentTime, 0.9);

    // Lågfrekvent mull — grundton + en oktav över, för ett djupt, kraftfullt
    // brummande basljud som ger verken betydligt mer fysisk tyngd och närvaro,
    // strax under det hörbara "svisch"-registret.
    const rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = "sine";
    rumbleOsc.frequency.value = 45;
    const rumbleOsc2 = ctx.createOscillator();
    rumbleOsc2.type = "sine";
    rumbleOsc2.frequency.value = 90;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleOsc.connect(rumbleGain);
    rumbleOsc2.connect(rumbleGain);
    rumbleGain.connect(masterGain);
    rumbleOsc.start();
    rumbleOsc2.start();
    // Se motsvarande kommentar vid windGain ovan — startar tyst, riktig
    // volym sätts av `updateProximity`.
    rumbleGain.gain.setTargetAtTime(0, ctx.currentTime, 1);

    nodesRef.current = {
      windSource,
      windGain,
      whooshSource,
      whooshFilter,
      whooshSwishGain,
      whooshGain,
      lfo,
      lfoShaper,
      lfoGain,
      whoosh2Source,
      whoosh2Filter,
      whoosh2SwishGain,
      whoosh2Gain,
      lfo2,
      lfo2Shaper,
      lfo2Gain,
      rumbleOsc,
      rumbleOsc2,
      rumbleGain,
      directionLfo,
      directionGain,
      masterGain,
      makeupGain,
      compressor,
      limiter,
      streamDestination,
    };
    // Nollställ utjämningen för en garanterat ren, tyst insvängning — annars
    // skulle en gammal `actualVolumeRef` från en tidigare ljudsession kunna
    // läcka in och ge ett hörbart "hopp" precis vid start.
    actualVolumeRef.current = 0;
    startAudioLoop();
    setPlaying(true);
  }

  /**
   * Sätter den senaste beräknade målvolymen och medel-RPM:et — läses av den
   * oberoende `AUDIO_TICK_MS`-loopen (`startAudioLoop` ovan), som applicerar
   * dem på de faktiska ljudnoderna via EMA-utjämning minst 10 ggr/sekund
   * (produktkrav). Anropas löpande när GPS-position eller den beräknade
   * ljudnivån ändras, men själva tillämpningen/utjämningen är INTE beroende
   * av hur ofta den här funktionen anropas.
   *
   * `targetVolume` (0..1) kommer från `lib/soundLevel.ts`s
   * `dbaToVolume(totalDba)` (se Home.tsx) och är den ENDA källan till
   * volymens skalning: volymen ska kontinuerligt och exakt följa den
   * beräknade dBA-nivån (låg beräknad nivå ⇒ tyst, hög nivå ⇒ högt), inte en
   * egen, fristående avstånds-/av-på-kurva. Eftersom `totalDba` redan
   * speglar ev. manuellt vald "Ljud inne" (se Home.tsx), faller
   * `targetVolume` naturligt mot 0 i det läget — samma logik gäller för
   * flera nära verk, som redan kombineras logaritmiskt i `combineLevelsDba`
   * innan de når hit.
   */
  function updateProximity(targetVolume: number, avgRpm: number) {
    targetVolumeRef.current = Math.min(Math.max(targetVolume, 0), 1);
    avgRpmRef.current = avgRpm;
  }

  return { playing, toggle, updateProximity, actualVolumeRef };
}
