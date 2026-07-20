import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

const PDF_URL_KEY = "vindkraft:pendingPdfUrl";
const PDF_TITLE_KEY = "vindkraft:pendingPdfTitle";
const PDF_OPENED_KEY = "vindkraft:pdfViewerOpened";

/**
 * Navigera till PDF-visarens hashroute.
 * Anropas från InfoPanel och PlaceTurbines på native.
 * Lagrar URL + titel i sessionStorage så PdfViewer kan läsa dem.
 */
export function openPdfRoute(url: string, title: string): void {
  sessionStorage.setItem(PDF_URL_KEY, url);
  sessionStorage.setItem(PDF_TITLE_KEY, title);
  sessionStorage.removeItem(PDF_OPENED_KEY);
  window.location.hash = "/pdf-viewer";
}

/**
 * Dedikerad PDF-visarsida för native (iOS/Android).
 *
 * Flöde:
 *  1. Komponenten monteras (från InfoPanel/PlaceTurbines → hash=#/pdf-viewer).
 *  2. useEffect navigerar WKWebView direkt till capacitor://localhost/xxx.pdf —
 *     native PDF-renderaren hanterar flersidig scrollning korrekt.
 *  3. Användaren ser PDF i nativt läge. Svep-tillbaka → React monteras igen
 *     vid samma hashroute med PDF_OPENED_KEY satt.
 *  4. Nu visas "← Tillbaka"-knapp + "Öppna PDF igen" istället för auto-redirect.
 */
export default function PdfViewer() {
  const [, navigate] = useLocation();
  const pdfUrl = sessionStorage.getItem(PDF_URL_KEY) ?? "";
  const pdfTitle = sessionStorage.getItem(PDF_TITLE_KEY) ?? "PDF-dokument";
  const alreadyOpened = !!sessionStorage.getItem(PDF_OPENED_KEY);
  const didNavigate = useRef(false);

  useEffect(() => {
    if (!alreadyOpened && pdfUrl && !didNavigate.current) {
      didNavigate.current = true;
      sessionStorage.setItem(PDF_OPENED_KEY, "1");
      window.location.href = pdfUrl;
    }
  }, [alreadyOpened, pdfUrl]);

  function goBack() {
    sessionStorage.removeItem(PDF_OPENED_KEY);
    navigate("/");
  }

  return (
    <div
      className="flex h-[100dvh] flex-col bg-[#111111] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#111111] px-4 py-3">
        <button
          onClick={goBack}
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 active:bg-white/30"
        >
          ← Tillbaka
        </button>
        <span className="flex-1 truncate text-sm text-white/60">📄 {pdfTitle}</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
        {alreadyOpened ? (
          <>
            <p className="text-sm text-white/60">
              PDF-dokumentet öppnades i visaren.
              <br />
              Svep från vänster för att bläddra bakåt, eller öppna det igen.
            </p>
            <button
              onClick={() => {
                sessionStorage.setItem(PDF_OPENED_KEY, "1");
                window.location.href = pdfUrl;
              }}
              className="rounded-full bg-[#FF8B01] px-6 py-3 text-sm font-semibold text-[#090909] hover:bg-[#FFB347]"
            >
              📄 Öppna PDF igen
            </button>
            <button
              onClick={goBack}
              className="rounded-full border border-white/20 px-6 py-2.5 text-sm text-white/70 hover:bg-white/10"
            >
              ← Tillbaka till appen
            </button>
          </>
        ) : (
          <p className="text-sm text-white/50">Öppnar PDF…</p>
        )}
      </div>
    </div>
  );
}
