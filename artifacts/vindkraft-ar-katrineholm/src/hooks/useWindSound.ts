import { useEffect, useRef, useState } from "react";

/**
 * Genererar ett mjukt, loopande vindljud proceduralt med Web Audio API
 * (filtrerat brus) — inga externa ljudfiler behövs.
 */
export function useWindSound() {
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode } | null>(null);

  useEffect(() => {
    return () => {
      nodesRef.current?.source.stop();
      ctxRef.current?.close();
    };
  }, []);

  function toggle() {
    if (playing) {
      nodesRef.current?.gain.gain.setTargetAtTime(0, ctxRef.current!.currentTime, 0.3);
      setTimeout(() => {
        nodesRef.current?.source.stop();
        nodesRef.current = null;
      }, 500);
      setPlaying(false);
      return;
    }

    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = ctxRef.current ?? new AudioContextCtor();
    ctxRef.current = ctx;

    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Brownian-ish noise filtered to sound wind-like
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 6;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 500;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    gain.gain.setTargetAtTime(0.35, ctx.currentTime, 0.4);

    nodesRef.current = { source, gain };
    setPlaying(true);
  }

  return { playing, toggle };
}
