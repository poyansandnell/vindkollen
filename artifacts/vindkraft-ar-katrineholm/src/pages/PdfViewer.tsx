import { useEffect } from "react";

const PDF_URL_KEY = "vindkraft:pendingPdfUrl";
const PDF_TITLE_KEY = "vindkraft:pendingPdfTitle";
const PDF_RETURN_ROUTE_KEY = "vindkraft:pdfReturnRoute";

/**
 * Navigera till PDF-visarens hashroute.
 * Anropas från InfoPanel och PlaceTurbines på native.
 */
export function openPdfRoute(url: string, title: string): void {
  sessionStorage.setItem(PDF_URL_KEY, url);
  sessionStorage.setItem(PDF_TITLE_KEY, title);
  localStorage.setItem(PDF_RETURN_ROUTE_KEY, window.location.hash || "#/");
  window.location.hash = "/pdf-viewer";
}

/**
 * Dedikerad PDF-visarsida.
 *
 * Visar PDF:en i en <iframe> som fyller hela skärmen under headern.
 * Headern med "← Tillbaka" är alltid synlig — användaren lämnar aldrig
 * React-appen och navigation tillbaka fungerar alltid pålitligt.
 *
 * Notering om iOS WKWebView: <iframe> med en PDF renderas av PDFKit
 * (native), men det yttre page-scrollen kan på äldre iOS-versioner
 * fånga pek-gesterna. Om användaren inte kan bläddra i PDF:en:
 * prova att svepa med två fingrar, eller använd "Öppna i nativt läge"-
 * knappen i headern för att öppna i systemets PDF-visare.
 */
export default function PdfViewer() {
  const pdfUrl = sessionStorage.getItem(PDF_URL_KEY) ?? "";
  const pdfTitle = sessionStorage.getItem(PDF_TITLE_KEY) ?? "PDF-dokument";
  const returnRoute = localStorage.getItem(PDF_RETURN_ROUTE_KEY) ?? "#/";

  // Rensa returmarkören när sidan monteras (vi behöver den inte längre).
  useEffect(() => {
    return () => {
      // Cleanup vid unmount — inget behöver göras.
    };
  }, []);

  function goBack() {
    const target = returnRoute.startsWith("#") ? returnRoute.slice(1) : "/";
    window.location.hash = target;
  }

  function openNative() {
    // Fallback: öppna i systemets native PDF-visare om iframe inte fungerar.
    window.location.href = pdfUrl;
  }

  return (
    <div
      className="flex h-[100dvh] flex-col bg-[#111111] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Header — alltid synlig ovanpå PDF:en */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#111111] px-3 py-2.5">
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 active:bg-white/30"
        >
          ← Tillbaka
        </button>
        <span className="min-w-0 flex-1 truncate text-sm text-white/60">
          📄 {pdfTitle}
        </span>
        <button
          onClick={openNative}
          className="shrink-0 rounded-full border border-white/15 px-3 py-2 text-xs text-white/50 hover:bg-white/10 hover:text-white/70"
          title="Öppna i systemets PDF-visare"
        >
          ↗ Nativt
        </button>
      </div>

      {/* PDF i iframe — fyller resterande höjd */}
      {pdfUrl ? (
        <div className="relative flex-1 overflow-hidden">
          <iframe
            src={pdfUrl}
            title={pdfTitle}
            className="absolute inset-0 h-full w-full border-0"
            // allow-same-origin krävs för att PDF-widgeten ska få läsa
            // filen på capacitor://localhost (same origin).
            sandbox="allow-same-origin allow-scripts"
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="text-sm text-white/40">Ingen PDF angiven.</p>
        </div>
      )}
    </div>
  );
}
