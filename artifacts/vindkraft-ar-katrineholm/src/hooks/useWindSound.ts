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
  compressor: DynamicsCompressorNode;
}

// Volymnivåerna är kraftigt höjda jämfört med tidigare version — målet är ett
// påtagligt, uppslukande ljudlandskap som påminner om att stå i närheten av
// moderna 250 m-verk (Vestas V162-6.2MW, navhöjd 169 m), snarare än ett
// diskret bakgrundssus. Projektets egen bullerutredning anger som mest ca
// 40 dBA ekvivalent ljudnivå vid närmaste bostad i värsta scenariot — det
// används här bara som inspiration för ljudkaraktären (aerodynamiskt bredbandigt
// brus, lågfrekvent mull, rytmisk bladpassage), inte som en exakt kalibrerad
// decibelnivå (webbljud kan inte återge en fysisk dB-nivå ändå).
// En DynamicsCompressorNode (masterbuss) håller allt inom säkert, klipp-fritt
// utrymme även när flera lager summeras på hög volym.
const AMBIENCE_BASE = 0.32;
const AMBIENCE_MAX = 0.62;
const WHOOSH_BASE = 0.38;
const WHOOSH_MAX = 0.78;
const WHOOSH2_BASE = 0.22;
const WHOOSH2_MAX = 0.48;
const RUMBLE_BASE = 0.22;
const RUMBLE_MAX = 0.46;
const PROXIMITY_RANGE_M = 3500;

/**
 * Genererar ett kraftigt, uppslukande vindkraftsljud helt proceduralt med Web
 * Audio API — inga externa ljudfiler behövs:
 *
 * - Bred, kontinuerlig vindsvep-ambience (filtrerat brus).
 * - Två oberoende bladsvisch-lager med olika takt/frekvens, för att låta som
 *   flera verk (t.ex. flera i närheten) som kombineras till ett tätare,
 *   kraftigare ljudlandskap snarare än ett enda rent tonalt mönster.
 * - Dubbla lågfrekventa mullr-oscillatorer (grundton + oktav) för fysisk tyngd.
 * - En långsam "vindriktnings"-LFO som moduleras in på master-volymen, så att
 *   ljudet naturligt sväller och avtar lite över tid — som om vindriktningen
 *   ändras — utan att kännas mekaniskt konstant.
 * - Volymen ökar ju närmare användaren är närmaste verk.
 * - En DynamicsCompressorNode på masterbussen förhindrar klippning även vid
 *   dessa betydligt högre volymnivåer.
 *
 * iPhone Safari (och andra webbläsare med autoplay-policy) kräver att
 * AudioContext startas/återupptas inom en direkt användarinteraktion —
 * `toggle()` anropas alltid från en knapptryckning, och vi anropar uttryck-
 * ligen `ctx.resume()` om kontexten är avstängd/suspenderad innan ljudet
 * startas, så att ljudet "låses upp" permanent efter första tryckningen.
 */
export function useWindSound() {
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<WindNodes | null>(null);

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
      ctxRef.current?.close();
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

  async function toggle() {
    if (playing) {
      const nodes = nodesRef.current;
      const ctx = ctxRef.current;
      if (nodes && ctx) {
        nodes.masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        setTimeout(() => {
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
          nodesRef.current = null;
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
    let ctx: AudioContext;
    try {
      ctx = ctxRef.current ?? new AudioContextCtor();
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

    // Masterbuss: allt ljud går genom en kompressor innan destinationen, så
    // att de betydligt högre volymnivåerna nedan aldrig klipper — den håller
    // toppar under kontroll medan den övergripande upplevda styrkan förblir hög.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -8;
    compressor.knee.value = 6;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.25;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);
    masterGain.gain.setTargetAtTime(1, ctx.currentTime, 0.6);

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
    whooshGain.gain.value = 0.05;
    whooshSource.connect(whooshFilter);
    whooshFilter.connect(whooshLowpass);
    whooshLowpass.connect(whooshGain);
    whooshGain.connect(masterGain);
    whooshSource.start();

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.22;
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
    whoosh2Gain.gain.value = 0.04;
    whoosh2Source.connect(whoosh2Filter);
    whoosh2Filter.connect(whoosh2Gain);
    whoosh2Gain.connect(masterGain);
    whoosh2Source.start();

    const lfo2 = ctx.createOscillator();
    lfo2.type = "sine";
    lfo2.frequency.value = 0.52;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.16;
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
      compressor,
    };
    setPlaying(true);
  }

  /**
   * Uppdaterar volym och svischtakt baserat på avstånd till närmaste verk
   * (meter) och rotorernas genomsnittliga varvtal (RPM). Anropas löpande när
   * GPS-position eller vindkraftsdata ändras — påverkar bara befintliga
   * ljudnoder, startar inget nytt ljud. Volymen ökar tydligt ju närmare
   * användaren är, men hålls alltid inom det klipp-fria intervall som
   * masterbussens kompressor garanterar.
   */
  function updateProximity(nearestDistanceMeters: number | null, avgRpm: number) {
    const nodes = nodesRef.current;
    const ctx = ctxRef.current;
    if (!nodes || !ctx) return;

    const dist = nearestDistanceMeters === null ? PROXIMITY_RANGE_M : Math.max(nearestDistanceMeters, 60);
    const proximity = Math.max(0, Math.min(1 - dist / PROXIMITY_RANGE_M, 1)); // 0 = långt bort, 1 = mycket nära

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
