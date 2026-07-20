import { useEffect, useRef } from "react";

const PDF_URL_KEY = "vindkraft:pendingPdfUrl";
const PDF_TITLE_KEY = "vindkraft:pendingPdfTitle";

/**
 * Navigera till PDF-visarens hashroute.
 * Anropas från InfoPanel och PlaceTurbines på native.
 * Lagrar URL + titel i sessionStorage så PdfViewer kan läsa dem.
 */
export function openPdfRoute(url: string, title: string): void {
  sessionStorage.setItem(PDF_URL_KEY, url);
  sessionStorage.setItem(PDF_TITLE_KEY, title);
  window.location.hash = "/pdf-viewer";
}

/**
 * Dedikerad PDF-visarsida för native (iOS/Android).
 *
 * Flöde:
 *  1. Komponenten monteras (hash = #/pdf-viewer).
 *  2. useEffect anropar window.location.replace(pdfUrl) — PDF:en ERSÄTTER
 *     #/pdf-viewer i WKWebView-historiken (lägger inte till ett extra steg).
 *  3. Svep-tillbaka från native PDF-visaren hoppar direkt tillbaka till
 *     sidan FÖRE #/pdf-viewer trycktes (t.ex. #/ eller #/placera).
 *     Inget mellanstopp på pdf-viewer — inga "kan inte komma tillbaka"-problem.
 *  4. "← Tillbaka"-knappen i headern anropar history.back() och är alltid
 *     synlig de ~100 ms sidan visas innan PDF:en tar över, som en nödutväg.
 */
export default function PdfViewer() {
  const pdfUrl = sessionStorage.getItem(PDF_URL_KEY) ?? "";
  const pdfTitle = sessionStorage.getItem(PDF_TITLE_KEY) ?? "PDF-dokument";
  const navigated = useRef(false);

  useEffect(() => {
    if (pdfUrl && !navigated.current) {
      navigated.current = true;
      // replace() ersätter nuvarande historypost — back() hoppar förbi pdf-viewer
      window.location.replace(pdfUrl);
    }
  }, [pdfUrl]);

  return (
    <div
      className="flex h-[100dvh] flex-col bg-[#111111] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#111111] px-4 py-3">
        <button
          onClick={() => window.history.back()}
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 active:bg-white/30"
        >
          ← Tillbaka
        </button>
        <span className="flex-1 truncate text-sm text-white/60">📄 {pdfTitle}</span>
      </div>

      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-sm text-white/40">Öppnar PDF…</p>
      </div>
    </div>
  );
}
