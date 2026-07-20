import { useEffect, useRef, useState } from "react";

const PDF_URL_KEY = "vindkraft:pendingPdfUrl";
const PDF_TITLE_KEY = "vindkraft:pendingPdfTitle";

/**
 * localStorage-nycklar för PDF-returflödet.
 *
 * Varför localStorage och inte sessionStorage?
 * WKWebView kan ladda om React-appen helt från scratch när användaren
 * sveper tillbaka från native PDF-visaren ("WebView loaded" syns dubbelt
 * i Xcode-loggen). sessionStorage nollställs vid WKWebView-omstart;
 * localStorage överlever och möjliggör pålitlig retur.
 *
 * Varför spara returroutten?
 * WKWebView-omstarten nollställer också window.history, så history.back()
 * har ingenstans att gå. Istället sparas hash-routten (t.ex. "#/placera")
 * och vi navigerar dit explicit med window.location.hash = returnRoute.
 */
const PDF_RETURN_KEY = "vindkraft:pdfReturn";
const PDF_RETURN_ROUTE_KEY = "vindkraft:pdfReturnRoute";

/**
 * Navigera till PDF-visarens hashroute.
 * Anropas från InfoPanel och PlaceTurbines på native.
 */
export function openPdfRoute(url: string, title: string): void {
  sessionStorage.setItem(PDF_URL_KEY, url);
  sessionStorage.setItem(PDF_TITLE_KEY, title);
  // Spara ursprungsroutten så goBack() kan navigera dit efter WKWebView-omstart.
  localStorage.setItem(
    PDF_RETURN_ROUTE_KEY,
    window.location.hash || "#/",
  );
  // Rensa eventuell kvarlämnad returmarkör.
  localStorage.removeItem(PDF_RETURN_KEY);
  window.location.hash = "/pdf-viewer";
}

/**
 * Dedikerad PDF-visarsida för native (iOS/Android).
 *
 * Flöde:
 *  1. Monteras vid #/pdf-viewer. Sparar returroutten i localStorage.
 *  2. Navigerar WKWebView till capacitor://localhost/xxx.pdf via
 *     window.location.href — native PDFKit, alla sidor scrollbara. ✓
 *  3. Användaren sveper tillbaka. WKWebView startar om React från scratch.
 *     localStorage.PDF_RETURN_KEY = "1" → returnedFromPdf = true. ✓
 *  4. Om BFCache används (frys/tina): pageshow-lyssnaren sätter
 *     returnedFromPdf = true via setState. ✓
 *  5. "← Tillbaka" rensar localStorage och navigerar till sparad returroutt
 *     (t.ex. #/ eller #/placera) via window.location.hash — tillförlitligt
 *     oavsett om history är tom efter WKWebView-omstart. ✓
 */
export default function PdfViewer() {
  const pdfUrl = sessionStorage.getItem(PDF_URL_KEY) ?? "";
  const pdfTitle = sessionStorage.getItem(PDF_TITLE_KEY) ?? "PDF-dokument";
  const returnRoute = localStorage.getItem(PDF_RETURN_ROUTE_KEY) ?? "#/";

  const [returnedFromPdf, setReturnedFromPdf] = useState<boolean>(
    () => !!localStorage.getItem(PDF_RETURN_KEY),
  );

  const navigated = useRef(false);

  // BFCache-fallback: om sidan återställs från fryst JS-tillstånd kör
  // inte useState-initialiseraren om — pageshow fångar det.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && localStorage.getItem(PDF_RETURN_KEY)) {
        setReturnedFromPdf(true);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Navigera till PDF första gången.
  useEffect(() => {
    if (!returnedFromPdf && pdfUrl && !navigated.current) {
      navigated.current = true;
      localStorage.setItem(PDF_RETURN_KEY, "1");
      window.location.href = pdfUrl;
    }
  }, [returnedFromPdf, pdfUrl]);

  function goBack() {
    localStorage.removeItem(PDF_RETURN_KEY);
    // Navigera explicit — history kan vara tom efter WKWebView-omstart.
    const target = returnRoute.startsWith("#") ? returnRoute.slice(1) : "/";
    window.location.hash = target;
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
