import { useEffect, useRef } from "react";

interface CameraBackgroundProps {
  stream: MediaStream | null;
  /** Extern ref som får en kopia av videoelementet, t.ex. för Fotomontage-fångst. */
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>;
  /**
   * True när kameran körs som native camera-preview (iOS/Android).
   * I detta läge renderas kameran som ett nativt lager bakom WKWebView —
   * inget video-element behövs eller renderas.
   */
  nativePreview?: boolean;
}

export function CameraBackground({ stream, videoRef: externalVideoRef, nativePreview }: CameraBackgroundProps) {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (internalVideoRef.current && stream) {
      internalVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Native: kameran renderas som ett nativt lager bakom WKWebView.
  // Inget HTML-videoelement krävs — returnera null så att videon
  // inte stör kamerafeedets genomskinliga bakgrund.
  if (nativePreview) return null;

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
