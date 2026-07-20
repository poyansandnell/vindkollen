import { useState } from "react";

const PDF_URL_KEY = "vindkraft:pendingPdfUrl";
const PDF_TITLE_KEY = "vindkraft:pendingPdfTitle";
const PDF_RETURN_ROUTE_KEY = "vindkraft:pdfReturnRoute";

export function openPdfRoute(url: string, title: string): void {
  sessionStorage.setItem(PDF_URL_KEY, url);
  sessionStorage.setItem(PDF_TITLE_KEY, title);
  localStorage.setItem(PDF_RETURN_ROUTE_KEY, window.location.hash || "#/");
  window.location.hash = "/pdf-viewer";
}

/**
 * Dedikerad PDF-visarsida.
 *
 * PDF:en visas i en <iframe>. Eftersom iOS WKWebView fångar scroll-gester
 * i iframe:s och hindrar bläddring till nästa sida, används Föregående/Nästa-
 * knappar som uppdaterar iframe:ns src med #page=N-fragmentet.
 */
export default function PdfViewer() {
  const pdfUrl = sessionStorage.getItem(PDF_URL_KEY) ?? "";
  const pdfTitle = sessionStorage.getItem(PDF_TITLE_KEY) ?? "PDF-dokument";
  const returnRoute = localStorage.getItem(PDF_RETURN_ROUTE_KEY) ?? "#/";

  const [page, setPage] = useState(1);

  function goBack() {
    const target = returnRoute.startsWith("#") ? returnRoute.slice(1) : "/";
    window.location.hash = target;
  }

  function prevPage() {
    setPage((p) => Math.max(1, p - 1));
  }

  function nextPage() {
    setPage((p) => p + 1);
  }

  // #page=N är ett standard PDF-URL-fragment som WKWebView/PDFKit hanterar.
  const iframeSrc = pdfUrl ? `${pdfUrl}#page=${page}` : "";

  return (
    <div
      className="flex h-[100dvh] flex-col bg-[#111111] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Övre rad: Tillbaka + titel */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#111111] px-3 py-2.5">
        <button
          onClick={goBack}
          className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 active:bg-white/30"
        >
          ← Tillbaka
        </button>
        <span className="min-w-0 flex-1 truncate text-sm text-white/60">
          📄 {pdfTitle}
        </span>
      </div>

      {/* PDF-yta */}
      {iframeSrc ? (
        <iframe
          key={page}
          src={iframeSrc}
          title={pdfTitle}
          className="min-h-0 flex-1 border-0"
          style={{ width: "100%", display: "block" }}
          sandbox="allow-same-origin allow-scripts"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="text-sm text-white/40">Ingen PDF angiven.</p>
        </div>
      )}

      {/* Nedre rad: sida-navigation */}
      <div
        className="flex shrink-0 items-center justify-between border-t border-white/10 bg-[#111111] px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <button
          onClick={prevPage}
          disabled={page <= 1}
          className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-30 hover:bg-white/20 active:bg-white/30"
        >
          ← Föregående
        </button>
        <span className="text-sm text-white/50">Sida {page}</span>
        <button
          onClick={nextPage}
          className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20 active:bg-white/30"
        >
          Nästa →
        </button>
      </div>
    </div>
  );
}
