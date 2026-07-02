import { useEffect, useState } from "react";

const WATERMARK_TEXT = "Katrineholm FRAMÅT – Vindkraft AR";
const DISCLAIMER_TEXT = "Fotomontage/visualisering. GPS, kompass, terräng, väder och sikt kan påverka precisionen.";

interface PhotoMontageModalProps {
  imageDataUrl: string;
  onRetake: () => void;
  onClose: () => void;
}

export function PhotoMontageModal({ imageDataUrl, onRetake, onClose }: PhotoMontageModalProps) {
  const [shareSupported, setShareSupported] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setShareSupported(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  function dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(",");
    const mime = header.match(/data:(.*);base64/)?.[1] ?? "image/png";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function handleSave() {
    const link = document.createElement("a");
    link.href = imageDataUrl;
    link.download = `vindkraft-ar-katrineholm-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatus("Bilden sparades.");
    window.setTimeout(() => setStatus(null), 2500);
  }

  async function handleShare() {
    try {
      const blob = dataUrlToBlob(imageDataUrl);
      const file = new File([blob], "vindkraft-ar-katrineholm.png", { type: blob.type });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        setStatus("Delning stöds inte på den här enheten — spara bilden istället.");
        return;
      }
      await navigator.share({
        files: [file],
        title: "Vindkraft AR Katrineholm",
        text: WATERMARK_TEXT,
      });
    } catch {
      // Avbruten delning eller ej tillgängligt API — ingen krasch, bara tyst.
      setStatus("Delning avbröts eller stöds inte.");
      window.setTimeout(() => setStatus(null), 2500);
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-black">
      <div className="flex-1 overflow-hidden">
        <img src={imageDataUrl} alt="Fotomontage av vindkraftverk" className="h-full w-full object-contain" />
      </div>

      {status && (
        <div className="absolute inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-10 flex justify-center px-4">
          <span className="rounded-full bg-white/15 px-4 py-1.5 text-xs text-white shadow-lg backdrop-blur-sm">
            {status}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 bg-[#141210] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <p className="text-center text-[11px] leading-relaxed text-white/50">{DISCLAIMER_TEXT}</p>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="flex-1 rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/30 hover:bg-[#FFB347]"
          >
            Spara bild
          </button>
          <button
            onClick={onRetake}
            className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
          >
            Ta ny bild
          </button>
        </div>
        <div className="flex gap-2">
          {shareSupported && (
            <button
              onClick={handleShare}
              className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              Dela
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10"
          >
            Stäng
          </button>
        </div>
      </div>
    </div>
  );
}
