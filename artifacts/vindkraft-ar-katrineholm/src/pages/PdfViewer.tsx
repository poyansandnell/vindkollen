import { useEffect, useRef, useState } from "react";

const PDF_URL_KEY = "vindkraft:pendingPdfUrl";
const PDF_TITLE_KEY = "vindkraft:pendingPdfTitle";

/**
 * Markör i localStorage (inte sessionStorage!) för att detektera att
 * WKWebView har navigerat tillbaka från native PDF-visaren.
 *
 * localStorage överlever WKWebView-omstart (till skillnad från sessionStorage
 * som kan nollställas när Capacitor laddar om appen efter PDF-navigering).
 */
const PDF_RETURN_KEY = "vindkraft:pdfReturn";

/**
 * Navigera till PDF-visarens hashroute.
 * Anropas från InfoPanel och PlaceTurbines på native.
 */
export function openPdfRoute(url: string, title: string): void {
  sessionStorage.setItem(PDF_URL_KEY, url);
  sessionStorage.setItem(PDF_TITLE_KEY, title);
  // Rensa eventuell kvarlämnad returmarkör så att nästa besök börjar rent.
  localStorage.removeItem(PDF_RETURN_KEY);
  window.location.hash = "/pdf-viewer";
}

/**
 * Dedikerad PDF-visarsida för native (iOS/Android).
 *
 * Flöde (native):
 *  1. Komponenten monteras vid #/pdf-viewer.
 *  2. Sätter localStorage.PDF_RETURN_KEY = "1" och navigerar via
 *     window.location.href = pdfUrl → WKWebView öppnar PDF med nativt PDFKit,
 *     alla sidor scrollbara. ✓
 *  3. Användaren sveper tillbaka. WKWebView kan ladda om React-appen helt
 *     (dvs. ingen BFCache). Appen startar om vid #/pdf-viewer.
 *  4. useState-initialiseraren läser localStorage.PDF_RETURN_KEY = "1" →
 *     returnedFromPdf = true → visas "← Tillbaka"-knappar. ✓
 *  5. Om BFCache-återställning används istället (React fryses/tinas):
 *     pageshow-lyssnaren fångar event.persisted = true och anropar
 *     setReturnedFromPdf(true) → React renderar om med knappar. ✓
 *  6. "← Tillbaka" rensar localStorage-markören och anropar history.back().
 */
export default function PdfViewer() {
  const pdfUrl = sessionStorage.getItem(PDF_URL_KEY) ?? "";
  const pdfTitle = sessionStorage.getItem(PDF_TITLE_KEY) ?? "PDF-dokument";

  const [returnedFromPdf, setReturnedFromPdf] = useState<boolean>(
    () => !!localStorage.getItem(PDF_RETURN_KEY),
  );

  const navigated = useRef(false);

  // BFCache-fallback: pageshow med persisted=true innebär att sidan
  // återställdes från fryst tillstånd — state-initialiseraren körde inte igen.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && localStorage.getItem(PDF_RETURN_KEY)) {
        setReturnedFromPdf(true);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Navigera till PDF första gången (när returnedFromPdf är false).
  useEffect(() => {
    if (!returnedFromPdf && pdfUrl && !navigated.current) {
      navigated.current = true;
      localStorage.setItem(PDF_RETURN_KEY, "1");
      window.location.href = pdfUrl;
    }
  }, [returnedFromPdf, pdfUrl]);

  function goBack() {
    localStorage.removeItem(PDF_RETURN_KEY);
    window.history.back();
  }

  return (
    <div
      className="flex h-[100dvh] flex-col bg-[#111111] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Header alltid synlig — nödutväg även om PDF inte öppnas */}
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#111111] px-4 py-3">
        <button
          onClick={goBack}
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 active:bg-white/30"
        >
          ← Tillbaka
        </button>
        <span className="flex-1 truncate text-sm text-white/60">
          📄 {pdfTitle}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
        {returnedFromPdf ? (
          <>
            <p className="text-sm text-white/60">
              PDF-dokumentet öppnades i visaren.
            </p>
            <button
              onClick={() => {
                localStorage.setItem(PDF_RETURN_KEY, "1");
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
          <p className="text-sm text-white/40">Öppnar PDF…</p>
        )}
      </div>
    </div>
  );
}
