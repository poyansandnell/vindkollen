import { useEffect, useRef, useState } from "react";

interface WindNodes {
  windSource: AudioBufferSourceNode;
  windGain: GainNode;
  whooshSource: AudioBufferSourceNode;
  whooshFilter: BiquadFilterNode;
  whooshGain: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  rumbleOsc: OscillatorNode;
  rumbleGain: GainNode;
}

const AMBIENCE_BASE = 0.08;
const AMBIENCE_MAX = 0.14;
const WHOOSH_BASE = 0.1;
const WHOOSH_MAX = 0.22;
const RUMBLE_BASE = 0.03;
const RUMBLE_MAX = 0.08;
const PROXIMITY_RANGE_M = 3500;

/**
 * Genererar realistiskt, loopande vindljud + ett "svisch"-ljud från rotor-
 * bladen + ett lågfrekvent mullrande basljud, helt proceduralt med Web Audio
 * API (filtrerat brus + oscillatorer) — inga externa ljudfiler behövs.
 * Volymen ökar ju närmare användaren är verken och tonas naturligt ut med
 * avståndet, men är alltid begränsad till en säker maxnivå. Svischljudets
 * takt varierar med rotorernas genomsnittliga varvtal.
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
        nodes?.lfo.stop();
        nodes?.rumbleOsc.stop();
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
        nodes.windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        nodes.whooshGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        nodes.rumbleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        setTimeout(() => {
          try {
            nodes.windSource.stop();
            nodes.whooshSource.stop();
            nodes.lfo.stop();
            nodes.rumbleOsc.stop();
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

    // Vindljud — bredbandigt, mjukt brusigt ambientljud.
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
    windGain.connect(ctx.destination);
    windSource.start();
    windGain.gain.setTargetAtTime(AMBIENCE_BASE, ctx.currentTime, 0.6);

    // Bladsvisch — smalare, ljusare brus, moduleras rytmiskt av en LFO vars
    // frekvens motsvarar rotorernas ungefärliga bladpassage-frekvens, så det
    // låter som vind som slår mot stora rotorblad snarare än jämnt brus.
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
    whooshGain.gain.value = 0.02;
    whooshSource.connect(whooshFilter);
    whooshFilter.connect(whooshLowpass);
    whooshLowpass.connect(whooshGain);
    whooshGain.connect(ctx.destination);
    whooshSource.start();

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.09;
    lfo.connect(lfoGain);
    lfoGain.connect(whooshGain.gain);
    lfo.start();

    whooshGain.gain.setTargetAtTime(WHOOSH_BASE, ctx.currentTime, 0.8);

    // Lågfrekvent mull — ett djupt, mjukt brummande basljud som ger verken
    // mer fysisk tyngd, precis under det hörbara "svisch"-registret.
    const rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = "sine";
    rumbleOsc.frequency.value = 52;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleOsc.connect(rumbleGain);
    rumbleGain.connect(ctx.destination);
    rumbleOsc.start();
    rumbleGain.gain.setTargetAtTime(RUMBLE_BASE, ctx.currentTime, 1);

    nodesRef.current = {
      windSource,
      windGain,
      whooshSource,
      whooshFilter,
      whooshGain,
      lfo,
      lfoGain,
      rumbleOsc,
      rumbleGain,
    };
    setPlaying(true);
  }

  /**
   * Uppdaterar volym och svischtakt baserat på avstånd till närmaste verk
   * (meter) och rotorernas genomsnittliga varvtal (RPM). Anropas löpande när
   * GPS-position eller vindkraftsdata ändras — påverkar bara befintliga
   * ljudnoder, startar inget nytt ljud. Volymen hålls alltid inom säkra,
   * begränsade intervall (aldrig påträngande högt).
   */
  function updateProximity(nearestDistanceMeters: number | null, avgRpm: number) {
    const nodes = nodesRef.current;
    const ctx = ctxRef.current;
    if (!nodes || !ctx) return;

    const dist = nearestDistanceMeters === null ? PROXIMITY_RANGE_M : Math.max(nearestDistanceMeters, 60);
    const proximity = Math.max(0, Math.min(1 - dist / PROXIMITY_RANGE_M, 1)); // 0 = långt bort, 1 = mycket nära

    const windTarget = AMBIENCE_BASE + proximity * (AMBIENCE_MAX - AMBIENCE_BASE);
    const whooshTarget = WHOOSH_BASE + proximity * (WHOOSH_MAX - WHOOSH_BASE);
    const rumbleTarget = RUMBLE_BASE + proximity * (RUMBLE_MAX - RUMBLE_BASE);

    nodes.windGain.gain.setTargetAtTime(windTarget, ctx.currentTime, 1.2);
    nodes.whooshGain.gain.setTargetAtTime(whooshTarget, ctx.currentTime, 1.2);
    nodes.rumbleGain.gain.setTargetAtTime(rumbleTarget, ctx.currentTime, 1.2);

    // Bladpassage: 3 blad per varv. Omvandlar RPM till Hz och dämpar till ett
    // hörbart, behagligt intervall.
    const bladePassHz = (Math.max(avgRpm, 1) / 60) * 3;
    nodes.lfo.frequency.setTargetAtTime(Math.min(Math.max(bladePassHz, 0.3), 2.2), ctx.currentTime, 1.5);
  }

  return { playing, toggle, updateProximity };
}
