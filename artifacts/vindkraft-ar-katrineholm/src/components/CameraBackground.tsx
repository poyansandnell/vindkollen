import { useEffect, useRef } from "react";

interface CameraBackgroundProps {
  stream: MediaStream | null;
  /** Extern ref som får en kopia av videoelementet, t.ex. för Fotomontage-fångst. */
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>;
}

export function CameraBackground({ stream, videoRef: externalVideoRef }: CameraBackgroundProps) {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (internalVideoRef.current && stream) {
      internalVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={(el) => {
        internalVideoRef.current = el;
        if (externalVideoRef) externalVideoRef.current = el;
      }}
      autoPlay
      playsInline
      muted
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
