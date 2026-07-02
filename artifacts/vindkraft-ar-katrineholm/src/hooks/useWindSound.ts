import { useEffect, useRef, useState } from "react";

interface WindNodes {
  windSource: AudioBufferSourceNode;
  windGain: GainNode;
  whooshSource: AudioBufferSourceNode;
  whooshFilter: BiquadFilterNode;
  whooshGain: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
}

const MAX_WIND_GAIN = 0.42;
const MAX_WHOOSH_GAIN = 0.2;
const PROXIMITY_RANGE_M = 3500;

/**
 * Genererar realistiskt, loopande vindljud + ett subtilt "svisch"-ljud från
 * rotorbladen proceduralt med Web Audio API (filtrerat brus) — inga externa
 * ljudfiler behövs. Volymen ökar något ju närmare användaren är verken och
 * tonas naturligt ut med avståndet (aldrig överdrivet högt). Svischljudets
 * takt varierar med rotorernas genomsnittliga varvtal.
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

  function toggle() {
    if (playing) {
      const nodes = nodesRef.current;
      const ctx = ctxRef.current;
      if (nodes && ctx) {
        nodes.windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        nodes.whooshGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        setTimeout(() => {
          try {
            nodes.windSource.stop();
            nodes.whooshSource.stop();
            nodes.lfo.stop();
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

    // Vindljud — bredbandigt, mjukt brusigt.
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
    windGain.gain.setTargetAtTime(0.22, ctx.currentTime, 0.6);

    // Bladsvisch — smalare, ljusare brus, moduleras rytmiskt av en LFO vars
    // frekvens motsvarar rotorernas ungefärliga bladpassage-frekvens.
    const whooshSource = ctx.createBufferSource();
    whooshSource.buffer = makeNoiseBuffer(ctx, 0.08);
    whooshSource.loop = true;
    const whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = "bandpass";
    whooshFilter.frequency.value = 900;
    whooshFilter.Q.value = 0.9;
    const whooshGain = ctx.createGain();
    whooshGain.gain.value = 0.05;
    whooshSource.connect(whooshFilter);
    whooshFilter.connect(whooshGain);
    whooshGain.connect(ctx.destination);
    whooshSource.start();

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain);
    lfoGain.connect(whooshGain.gain);
    lfo.start();

    whooshGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.8);

    nodesRef.current = { windSource, windGain, whooshSource, whooshFilter, whooshGain, lfo, lfoGain };
    setPlaying(true);
  }

  /**
   * Uppdaterar volym och svischtakt baserat på avstånd till närmaste verk
   * (meter) och rotorernas genomsnittliga varvtal (RPM). Anropas löpande när
   * GPS-position eller vindkraftsdata ändras — påverkar bara befintliga
   * ljudnoder, startar inget nytt ljud.
   */
  function updateProximity(nearestDistanceMeters: number | null, avgRpm: number) {
    const nodes = nodesRef.current;
    const ctx = ctxRef.current;
    if (!nodes || !ctx) return;

    const dist = nearestDistanceMeters === null ? PROXIMITY_RANGE_M : Math.max(nearestDistanceMeters, 60);
    const proximity = Math.max(0, 1 - dist / PROXIMITY_RANGE_M); // 0 = långt bort, 1 = mycket nära

    const windTarget = Math.min(0.16 + proximity * 0.22, MAX_WIND_GAIN);
    const whooshTarget = Math.min(0.03 + proximity * 0.14, MAX_WHOOSH_GAIN);

    nodes.windGain.gain.setTargetAtTime(windTarget, ctx.currentTime, 1.2);
    nodes.whooshGain.gain.setTargetAtTime(whooshTarget, ctx.currentTime, 1.2);

    // Bladpassage: 3 blad per varv. Omvandlar RPM till Hz och dämpar till ett
    // hörbart, behagligt intervall.
    const bladePassHz = (Math.max(avgRpm, 1) / 60) * 3;
    nodes.lfo.frequency.setTargetAtTime(Math.min(Math.max(bladePassHz, 0.3), 2.2), ctx.currentTime, 1.5);
  }

  return { playing, toggle, updateProximity };
}
