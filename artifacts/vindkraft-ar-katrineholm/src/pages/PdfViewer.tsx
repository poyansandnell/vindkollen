import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

// Worker-URL löses av Vite vid build-tid.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

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
 * PDF-visare med PDF.js canvas-rendering.
 *
 * PDF.js renderar varje sida till en <canvas> — detta kringgår problemet
 * att iOS WKWebView inte kan scrolla mellan sidor i en <iframe>.
 * "← Föregående" och "Nästa →" bläddrar explicit mellan sidor.
 * "← Tillbaka" i headern är alltid synlig och fungerar pålitligt.
 *
 * PDF:en hämtas som ArrayBuffer via fetch() så att PDF.js slipper
 * hantera capacitor://-schemat direkt (fetch() fungerar normalt i WKWebView
 * för same-origin-resurser).
 */
export default function PdfViewer() {
  const pdfUrl = sessionStorage.getItem(PDF_URL_KEY) ?? "";
  const pdfTitle = sessionStorage.getItem(PDF_TITLE_KEY) ?? "PDF-dokument";
  const returnRoute = localStorage.getItem(PDF_RETURN_ROUTE_KEY) ?? "#/";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel?: () => void } | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Ladda PDF-dokumentet
  useEffect(() => {
    if (!pdfUrl) {
      setStatus("error");
      setErrorMsg("Ingen PDF angiven.");
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        setStatus("loading");
        const res = await fetch(pdfUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[PdfViewer] Laddningsfel:", err);
        setStatus("error");
        setErrorMsg("Kunde inte ladda PDF:en.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // Rendera aktuell sida på canvas
  useEffect(() => {
    if (status !== "ready" || !pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    void (async () => {
      try {
        const pdfPage = await pdfDoc.getPage(page);
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;

        const containerWidth =
          canvas.parentElement?.clientWidth ?? window.innerWidth;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const scale = containerWidth / baseViewport.width;
        const viewport = pdfPage.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Avbryt eventuell pågående render-uppgift
        renderTaskRef.current?.cancel?.();

        // pdfjs-dist v6: render() tar canvas-elementet direkt (inte ctx).
        const task = pdfPage.render({ canvas, viewport });
        renderTaskRef.current = task as unknown as { cancel?: () => void };
        await task.promise;
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("cancelled") && !msg.includes("Rendering cancelled")) {
          console.error("[PdfViewer] Renderingsfel:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, page, status]);

  function goBack() {
    const target = returnRoute.startsWith("#") ? returnRoute.slice(1) : "/";
    window.location.hash = target;
  }

  return (
    <div
      className="flex h-[100dvh] flex-col bg-[#111111] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Header — alltid synlig */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#111111] px-3 py-2.5">
        <button
          onClick={goBack}
          className="flex shrink-0 items-center rounded-full bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 active:bg-white/30"
        >
          ← Tillbaka
        </button>
        <span className="min-w-0 flex-1 truncate text-sm text-white/60">
          📄 {pdfTitle}
        </span>
        {totalPages > 0 && (
          <span className="shrink-0 text-xs text-white/40">
            {page}/{totalPages}
          </span>
        )}
      </div>

      {/* PDF-yta */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        {status === "loading" && (
          <div className="flex h-full items-center justify-center bg-[#111111]">
            <p className="text-sm text-white/40">Laddar PDF…</p>
          </div>
        )}
        {status === "error" && (
          <div className="flex h-full items-center justify-center bg-[#111111] p-8 text-center">
            <p className="text-sm text-red-400">{errorMsg}</p>
          </div>
        )}
        {status === "ready" && (
          <canvas ref={canvasRef} className="block w-full" />
        )}
      </div>

      {/* Sidnavigering */}
      <div
        className="flex shrink-0 items-center justify-between border-t border-white/10 bg-[#111111] px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-30 hover:bg-white/20 active:bg-white/30"
        >
          ← Föregående
        </button>
        <span className="text-sm text-white/50">
          {totalPages > 0 ? `Sida ${page} av ${totalPages}` : "Laddar…"}
        </span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={totalPages > 0 && page >= totalPages}
          className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-30 hover:bg-white/20 active:bg-white/30"
        >
          Nästa →
        </button>
      </div>
    </div>
  );
}
