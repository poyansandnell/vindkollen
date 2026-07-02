import { useEffect, useRef, useState } from "react";

interface WindNodes {
  windSource: AudioBufferSourceNode;
  windGain: GainNode;
  whooshSource: AudioBufferSourceNode;
  whooshFilter: BiquadFilterNode;
  whooshGain: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  whoosh2Source: AudioBufferSourceNode;
  whoosh2Filter: BiquadFilterNode;
  whoosh2Gain: GainNode;
  lfo2: OscillatorNode;
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

// Volymnivåerna är kraftigt höjda jämfört med en tidigare version — målet är
// ett omedelbart märkbart, uppslukande ljudlandskap som påminner om att stå
// utomhus nära flera stora, moderna 250 m-verk (Vestas V162-6.2MW, navhöjd
// 169 m) i drift, snarare än ett diskret bakgrundssus. Projektets egen
// bullerutredning anger som mest ca 40 dBA ekvivalent ljudnivå vid närmaste
// bostad i värsta scenariot — det används här bara som inspiration för
// ljudkaraktären (aerodynamiskt bredbandigt brus, lågfrekvent mull, rytmisk
// bladpassage), inte som en exakt kalibrerad decibelnivå (webbljud kan inte
// återge en fysisk dB-nivå ändå; se `lib/soundLevel.ts` för den separata,
// informativa dBA-uppskattningen som INTE styr denna volym).
//
// Den stora volymökningen uppnås inte bara genom råa gain-värden, utan
// framför allt genom en hårdare kompressor (lägre tröskel/högre ratio) +
// en makeup-gain-nod efteråt som lyfter den komprimerade signalen tillbaka
// upp mot fullt utslag — en klassisk "loudness"-teknik som ger ett tätt,
// kraftfullt ljud utan att det digitalt klipper. En sista mjuk klippnings-
// (WaveShaper-)nod fungerar som ett absolut säkerhetsnät mot överstyrning.
const AMBIENCE_BASE = 0.55;
const AMBIENCE_MAX = 0.95;
const WHOOSH_BASE = 0.68;
const WHOOSH_MAX = 1.15;
const WHOOSH2_BASE = 0.4;
const WHOOSH2_MAX = 0.72;
const RUMBLE_BASE = 0.36;
const RUMBLE_MAX = 0.66;
const PROXIMITY_RANGE_M = 3500;
// Flera närliggande verk kombineras (se updateProximity) till en total
// "närhetsfaktor" som kan överstiga 1 — så att många verk nära inpå
// tillsammans låter tydligt kraftfullare än ett enda ensamt verk.
const MAX_COMBINED_PROXIMITY = 1.9;

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
 * - Volymen ökar ju närmare användaren är verken, och flera verk inom räckhåll
 *   kombineras till en högre total volym (se updateProximity).
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

  useEffect(() => {
    return () => {
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
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -26;
    compressor.knee.value = 8;
    compressor.ratio.value = 18;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;

    const makeupGain = ctx.createGain();
    makeupGain.gain.value = 2.7;

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
    windGain.gain.setTargetAtTime(AMBIENCE_BASE, ctx.currentTime, 0.6);

    // Bladsvisch, lager 1 — smalare, ljusare brus, moduleras rytmiskt av en
    // LFO vars frekvens motsvarar rotorernas ungefärliga bladpassage-frekvens.
    const whooshSource = ctx.createBufferSource();
    whooshSource.buffer = makeNoiseBuffer(ctx, 0.1);
    whooshSource.loop = true;
    const whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = "bandpass";
    whooshFilter.frequency.value = 850;
    whooshFilter.Q.value = 0.85;
    const whooshLowpass = ctx.createBiquadFilter();
    whooshLowpass.type = "lowpass";
    whooshLowpass.frequency.value = 2200;
    const whooshGain = ctx.createGain();
    whooshGain.gain.value = 0.08;
    whooshSource.connect(whooshFilter);
    whooshFilter.connect(whooshLowpass);
    whooshLowpass.connect(whooshGain);
    whooshGain.connect(masterGain);
    whooshSource.start();

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.3;
    lfo.connect(lfoGain);
    lfoGain.connect(whooshGain.gain);
    lfo.start();

    whooshGain.gain.setTargetAtTime(WHOOSH_BASE, ctx.currentTime, 0.8);

    // Bladsvisch, lager 2 — ett andra, oberoende svischlager med en annan
    // filterkaraktär och egen (lätt förskjuten) takt. Simulerar flera verk
    // vars bladpassager inte är perfekt synkroniserade, vilket ger ett
    // tätare, mer verklighetstroget och kraftfullare kombinerat ljudlandskap
    // istället för ett enda, uppenbart repetitivt mönster.
    const whoosh2Source = ctx.createBufferSource();
    whoosh2Source.buffer = makeNoiseBuffer(ctx, 0.14);
    whoosh2Source.loop = true;
    const whoosh2Filter = ctx.createBiquadFilter();
    whoosh2Filter.type = "bandpass";
    whoosh2Filter.frequency.value = 620;
    whoosh2Filter.Q.value = 0.7;
    const whoosh2Gain = ctx.createGain();
    whoosh2Gain.gain.value = 0.06;
    whoosh2Source.connect(whoosh2Filter);
    whoosh2Filter.connect(whoosh2Gain);
    whoosh2Gain.connect(masterGain);
    whoosh2Source.start();

    const lfo2 = ctx.createOscillator();
    lfo2.type = "sine";
    lfo2.frequency.value = 0.52;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.22;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(whoosh2Gain.gain);
    lfo2.start();

    whoosh2Gain.gain.setTargetAtTime(WHOOSH2_BASE, ctx.currentTime, 0.9);

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
    rumbleGain.gain.setTargetAtTime(RUMBLE_BASE, ctx.currentTime, 1);

    nodesRef.current = {
      windSource,
      windGain,
      whooshSource,
      whooshFilter,
      whooshGain,
      lfo,
      lfoGain,
      whoosh2Source,
      whoosh2Filter,
      whoosh2Gain,
      lfo2,
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
    setPlaying(true);
  }

  /**
   * Uppdaterar volym och svischtakt baserat på avstånd till samtliga verk
   * (meter) och rotorernas genomsnittliga varvtal (RPM). Anropas löpande när
   * GPS-position eller vindkraftsdata ändras — påverkar bara befintliga
   * ljudnoder, startar inget nytt ljud.
   *
   * Istället för att bara titta på det närmaste verket summeras ett bidrag
   * från varje verk inom räckhåll (`PROXIMITY_RANGE_M`) — flera närliggande
   * verk kombineras därmed till en tydligt högre total volym än ett enda
   * ensamt verk, precis som ett riktigt vindkraftverksområde låter kraftigare
   * ju fler verk som är i drift nära lyssnaren. Varje bidrag använder en
   * uppmjukad (kvadratrotsliknande) avtagandekurva så att volymen förblir
   * tydligt hörbar även på medelavstånd, istället för att nästan tystna.
   */
  function updateProximity(distancesMeters: number[], avgRpm: number) {
    const nodes = nodesRef.current;
    const ctx = ctxRef.current;
    if (!nodes || !ctx) return;

    const distances = distancesMeters.length > 0 ? distancesMeters : [PROXIMITY_RANGE_M];
    let combined = 0;
    for (const raw of distances) {
      const d = Math.max(raw, 60);
      if (d >= PROXIMITY_RANGE_M) continue;
      const linear = 1 - d / PROXIMITY_RANGE_M; // 0 = utom räckhåll, 1 = precis vid tornet
      combined += Math.pow(linear, 0.55); // mjukare avtagande — hörbart även på medelavstånd
    }
    const proximity = Math.min(combined, MAX_COMBINED_PROXIMITY);

    const windTarget = AMBIENCE_BASE + proximity * (AMBIENCE_MAX - AMBIENCE_BASE);
    const whooshTarget = WHOOSH_BASE + proximity * (WHOOSH_MAX - WHOOSH_BASE);
    const whoosh2Target = WHOOSH2_BASE + proximity * (WHOOSH2_MAX - WHOOSH2_BASE);
    const rumbleTarget = RUMBLE_BASE + proximity * (RUMBLE_MAX - RUMBLE_BASE);

    nodes.windGain.gain.setTargetAtTime(windTarget, ctx.currentTime, 1.2);
    nodes.whooshGain.gain.setTargetAtTime(whooshTarget, ctx.currentTime, 1.2);
    nodes.whoosh2Gain.gain.setTargetAtTime(whoosh2Target, ctx.currentTime, 1.2);
    nodes.rumbleGain.gain.setTargetAtTime(rumbleTarget, ctx.currentTime, 1.2);

    // Bladpassage: 3 blad per varv. Omvandlar RPM till Hz och dämpar till ett
    // hörbart, behagligt intervall. Lager 2 körs i en lätt förskjuten takt
    // (motsvarande ett närliggande, inte helt synkroniserat verk).
    const bladePassHz = (Math.max(avgRpm, 1) / 60) * 3;
    const clampedHz = Math.min(Math.max(bladePassHz, 0.3), 2.2);
    nodes.lfo.frequency.setTargetAtTime(clampedHz, ctx.currentTime, 1.5);
    nodes.lfo2.frequency.setTargetAtTime(clampedHz * 0.87, ctx.currentTime, 1.5);
  }

  return { playing, toggle, updateProximity };
}
