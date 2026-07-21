import { useState, useRef, useCallback } from "react";

type Device = "iphone" | "ipad" | "watch";

const WATCH_SLIDES = [
  { id: 1, line1: "Se vindkraft", line2: "i AR", filename: "vindkollen-watch-1.png" },
  { id: 2, line1: "Avstånd &", line2: "riktning", filename: "vindkollen-watch-2.png" },
  { id: 3, line1: "Hela", line2: "Sverige", filename: "vindkollen-watch-3.png" },
  { id: 4, line1: "Analysera", line2: "placering", filename: "vindkollen-watch-4.png" },
];

const SLIDES = [
  {
    id: 1,
    headline: "Se framtidens\nvindkraft\nredan idag",
    subheadline: "Visualisera vindkraftverk direkt i den verkliga miljön med hjälp av AR.",
    image: "/appstore/ar-dagsljus.png",
    filename: "vindkollen-1-ar-dagsljus.png",
  },
  {
    id: 2,
    headline: "Upplev vindkraft\n– dag och natt",
    subheadline: "Se hur landskapet förändras under olika tider på dygnet.",
    image: "/appstore/ar-kvall-tak.png",
    filename: "vindkollen-2-ar-kvall.png",
  },
  {
    id: 3,
    headline: "Se utsikten\nfrån din\negen plats",
    subheadline: "Placera dig där du bor och upplev hur vindkraftverken kan komma att synas.",
    image: "/appstore/ar-natt-gata.png",
    filename: "vindkollen-3-ar-natt.png",
  },
  {
    id: 4,
    headline: "Utforska hela\nSveriges\nvindkraft",
    subheadline: "Över 3 500 projekt och mer än 13 000 vindkraftverk samlade på en interaktiv karta.",
    image: "/appstore/sverigekartan.png",
    filename: "vindkollen-4-sverigekartan.png",
  },
  {
    id: 5,
    headline: "Analysera\ninnan beslut\nfattas",
    subheadline: "Flytta verk, jämför placeringar och se hur olika alternativ påverkar omgivningen.",
    image: "/appstore/redigering.png",
    filename: "vindkollen-5-redigering.png",
  },
  {
    id: 6,
    headline: "Kom igång\npå några\nsekunder",
    subheadline: "Öppna kartan eller starta AR direkt och börja utforska.",
    image: "/appstore/start.png",
    filename: "vindkollen-6-start.png",
  },
];

const TOPO_PATHS = [
  "M-100,600 C100,550 200,520 400,540 S700,580 900,560 S1100,520 1390,530",
  "M-100,680 C50,630 180,600 380,620 S680,660 920,640 S1150,600 1390,610",
  "M-100,760 C80,710 200,690 420,705 S700,740 950,720 S1180,685 1390,695",
  "M-100,840 C60,790 190,770 410,788 S710,820 970,800 S1200,770 1390,778",
  "M-100,920 C90,875 210,858 450,870 S740,900 1000,882 S1220,855 1390,862",
  "M-100,440 C120,390 250,370 480,385 S760,415 1020,398 S1240,372 1390,380",
  "M-100,360 C110,315 240,298 470,312 S750,340 1010,325 S1230,300 1390,308",
  "M-100,280 C100,238 230,222 460,235 S740,262 1000,248 S1225,225 1390,232",
  "M-100,200 C90,160 220,145 450,158 S730,184 990,170 S1220,148 1390,155",
  "M-100,120 C80,82 210,68 440,80 S720,105 980,92 S1218,72 1390,78",
  "M-100,1000 C70,958 195,940 430,952 S715,978 975,963 S1210,940 1390,947",
  "M-100,1080 C60,1040 185,1023 420,1035 S708,1060 968,1046 S1208,1024 1390,1030",
];

function TopoBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 1284 2778"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="glow" cx="50%" cy="35%" r="55%">
          <stop offset="0%" stopColor="#FF8B01" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#FF8B01" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1284" height="2778" fill="url(#glow)" />
      {/* Topographic contour lines — repeated vertically */}
      {[0, 1, 2].map((rep) =>
        TOPO_PATHS.map((d, i) => (
          <path
            key={`${rep}-${i}`}
            d={d.replace(/(\d+),(\d+)/g, (_, x, y) =>
              `${(parseInt(x) * 1284) / 1390},${parseInt(y) + rep * 1100}`
            )}
            fill="none"
            stroke="#FF8B01"
            strokeWidth="1.5"
            strokeOpacity="0.055"
          />
        ))
      )}
    </svg>
  );
}

function IPhoneFrame({ imageSrc }: { imageSrc: string }) {
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "390/844",
        borderRadius: "44px",
        border: "6px solid #2c2c2e",
        boxShadow:
          "0 0 0 1px #3a3a3c, inset 0 0 0 1px #1c1c1e, 0 40px 120px rgba(0,0,0,0.9), 0 8px 32px rgba(0,0,0,0.6)",
        overflow: "hidden",
        position: "relative",
        background: "#000",
      }}
    >
      {/* Dynamic island */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "34%",
          height: "26px",
          background: "#000",
          borderRadius: "20px",
          zIndex: 10,
        }}
      />
      <img
        src={imageSrc}
        alt="App screenshot"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "top center",
          display: "block",
        }}
      />
    </div>
  );
}

function Slide({
  slide,
  slideRef,
}: {
  slide: (typeof SLIDES)[0];
  slideRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div
      ref={slideRef}
      style={{
        width: "428px",
        height: "926px",
        background: "#0a0a0a",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
        flexShrink: 0,
      }}
    >
      <TopoBackground />

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "48px 32px 36px",
          boxSizing: "border-box",
        }}
      >
        {/* Brand */}
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#FF8B01",
            marginBottom: "18px",
            opacity: 0.9,
          }}
        >
          Vindkollen AR
        </div>

        {/* Headline */}
        <h1
          style={{
            fontSize: "38px",
            fontWeight: 800,
            lineHeight: 1.08,
            color: "#ffffff",
            margin: 0,
            marginBottom: "14px",
            whiteSpace: "pre-line",
            letterSpacing: "-0.02em",
          }}
        >
          {slide.headline}
        </h1>

        {/* Subheadline */}
        <p
          style={{
            fontSize: "14px",
            fontWeight: 400,
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.55)",
            margin: 0,
            marginBottom: "28px",
            maxWidth: "320px",
          }}
        >
          {slide.subheadline}
        </p>

        {/* Divider */}
        <div
          style={{
            width: "36px",
            height: "2px",
            background: "#FF8B01",
            borderRadius: "1px",
            marginBottom: "28px",
            opacity: 0.8,
          }}
        />

        {/* iPhone with screenshot */}
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", maxWidth: "320px", margin: "0 auto" }}>
            <IPhoneFrame imageSrc={slide.image} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TurbineSVG() {
  return (
    <svg viewBox="0 0 80 120" width="80" height="120" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      {/* Tower */}
      <line x1="40" y1="60" x2="40" y2="115" stroke="#FF8B01" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      {/* Base */}
      <line x1="30" y1="115" x2="50" y2="115" stroke="#FF8B01" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      {/* Blades */}
      <line x1="40" y1="60" x2="40" y2="10" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
      <line x1="40" y1="60" x2="6"  y2="82" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
      <line x1="40" y1="60" x2="74" y2="82" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
      {/* Hub */}
      <circle cx="40" cy="60" r="4" fill="#FF8B01" />
    </svg>
  );
}

function WatchSlide({
  slide,
  slideRef,
}: {
  slide: (typeof WATCH_SLIDES)[0];
  slideRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div
      ref={slideRef}
      style={{
        width: "422px",
        height: "514px",
        background: "#0a0a0a",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
        flexShrink: 0,
        boxSizing: "border-box",
        padding: "48px 36px 44px",
      }}
    >
      {/* Subtle topo background */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        viewBox="0 0 422 514"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="glow-watch" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#FF8B01" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#FF8B01" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="422" height="514" fill="url(#glow-watch)" />
        {TOPO_PATHS.slice(0, 6).map((d, i) => (
          <path
            key={i}
            d={d.replace(/(\d+),(\d+)/g, (_, x, y) =>
              `${(parseInt(x) * 422) / 1390},${parseInt(y) * 0.38}`
            )}
            fill="none"
            stroke="#FF8B01"
            strokeWidth="1"
            strokeOpacity="0.07"
          />
        ))}
      </svg>

      {/* Brand label */}
      <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "#FF8B01", opacity: 0.9 }}>
          Vindkollen
        </div>
      </div>

      {/* Turbine illustration */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <TurbineSVG />
      </div>

      {/* Text */}
      <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
        <div style={{ fontSize: "34px", fontWeight: 800, lineHeight: 1.1, color: "#ffffff", letterSpacing: "-0.02em" }}>
          {slide.line1}
        </div>
        <div style={{ fontSize: "34px", fontWeight: 800, lineHeight: 1.1, color: "#FF8B01", letterSpacing: "-0.02em" }}>
          {slide.line2}
        </div>
      </div>
    </div>
  );
}

function IPadSlide({
  slide,
  slideRef,
}: {
  slide: (typeof SLIDES)[0];
  slideRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div
      ref={slideRef}
      style={{
        width: "1024px",
        height: "1366px",
        background: "#0a0a0a",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
        flexShrink: 0,
      }}
    >
      {/* Topo background – reuse same SVG, wider viewBox */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1024 1366"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="glow-ipad" cx="50%" cy="35%" r="55%">
            <stop offset="0%" stopColor="#FF8B01" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#FF8B01" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1024" height="1366" fill="url(#glow-ipad)" />
        {[0, 1].map((rep) =>
          TOPO_PATHS.map((d, i) => (
            <path
              key={`${rep}-${i}`}
              d={d.replace(/(\d+),(\d+)/g, (_, x, y) =>
                `${(parseInt(x) * 1024) / 1390},${parseInt(y) + rep * 1100}`
              )}
              fill="none"
              stroke="#FF8B01"
              strokeWidth="1.5"
              strokeOpacity="0.055"
            />
          ))
        )}
      </svg>

      {/* Left column – text */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "420px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 56px 80px 72px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase" as const,
            color: "#FF8B01",
            marginBottom: "24px",
            opacity: 0.9,
          }}
        >
          Vindkollen AR
        </div>
        <h1
          style={{
            fontSize: "52px",
            fontWeight: 800,
            lineHeight: 1.06,
            color: "#ffffff",
            margin: 0,
            marginBottom: "20px",
            whiteSpace: "pre-line",
            letterSpacing: "-0.025em",
          }}
        >
          {slide.headline}
        </h1>
        <div
          style={{
            width: "40px",
            height: "3px",
            background: "#FF8B01",
            borderRadius: "2px",
            marginBottom: "20px",
            opacity: 0.8,
          }}
        />
        <p
          style={{
            fontSize: "18px",
            fontWeight: 400,
            lineHeight: 1.55,
            color: "rgba(255,255,255,0.55)",
            margin: 0,
          }}
        >
          {slide.subheadline}
        </p>
      </div>

      {/* Right column – iPhone mockup */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 72px 60px 24px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ width: "100%", maxWidth: "340px" }}>
          <IPhoneFrame imageSrc={slide.image} />
        </div>
      </div>
    </div>
  );
}

async function downloadSlide(
  slideEl: HTMLDivElement,
  filename: string,
  scale = 3
) {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(slideEl, {
    scale,
    useCORS: true,
    backgroundColor: "#0a0a0a",
    logging: false,
  });
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

export default function AppStoreScreenshots() {
  const [current, setCurrent] = useState(0);
  const [device, setDevice] = useState<Device>("iphone");
  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const slideRef = useRef<HTMLDivElement>(null);
  const allSlideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const allIPadRefs = useRef<(HTMLDivElement | null)[]>([]);
  const allWatchRefs = useRef<(HTMLDivElement | null)[]>([]);

  const isWatch = device === "watch";
  const slides = isWatch ? WATCH_SLIDES : SLIDES;
  const scale = device === "ipad" ? 2 : 1;  // watch=1 (422×514 exact), ipad=2, iphone uses 3 below
  const dlScale = device === "iphone" ? 3 : device === "ipad" ? 2 : 1;

  const filenameFor = useCallback((slide: { filename: string }) => slide.filename, []);

  const handleDownload = useCallback(async () => {
    if (!slideRef.current) return;
    setDownloading(true);
    try {
      await downloadSlide(slideRef.current, slides[current].filename, dlScale);
    } finally {
      setDownloading(false);
    }
  }, [current, dlScale, slides]);

  const handleDownloadAll = useCallback(async () => {
    setDownloadingAll(true);
    try {
      const refs = device === "ipad" ? allIPadRefs : device === "watch" ? allWatchRefs : allSlideRefs;
      for (let i = 0; i < slides.length; i++) {
        const el = refs.current[i];
        if (!el) continue;
        await downloadSlide(el, slides[i].filename, dlScale);
        await new Promise((r) => setTimeout(r, 600));
      }
    } finally {
      setDownloadingAll(false);
    }
  }, [device, dlScale, slides]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#050505",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "32px 16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ width: "100%", maxWidth: "960px", marginBottom: "32px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <h2
              style={{
                color: "#fff",
                fontSize: "20px",
                fontWeight: 700,
                margin: 0,
              }}
            >
              App Store-skärmbilder
            </h2>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px", margin: "4px 0 0" }}>
              {current + 1} / {slides.length} ·{" "}
              {device === "iphone"
                ? "428 × 926 px (3× = 1284 × 2778)"
                : device === "ipad"
                ? "1024 × 1366 px (2× = 2048 × 2732)"
                : "422 × 514 px (Ultra 3)"}
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            {/* Device toggle */}
            <div style={{ display: "flex", borderRadius: "20px", overflow: "hidden", border: "1px solid rgba(255,139,1,0.25)" }}>
              {(["iphone", "ipad", "watch"] as Device[]).map((d) => (
                <button
                  key={d}
                  onClick={() => { setDevice(d); setCurrent(0); }}
                  style={{
                    background: device === d ? "#FF8B01" : "transparent",
                    color: device === d ? "#000" : "rgba(255,255,255,0.5)",
                    border: "none",
                    padding: "8px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.05em",
                  }}
                >
                  {d === "iphone" ? "📱 iPhone" : d === "ipad" ? "🖥 iPad" : "⌚ Watch"}
                </button>
              ))}
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{
                background: "#FF8B01",
                color: "#000",
                border: "none",
                borderRadius: "20px",
                padding: "10px 20px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: downloading ? "wait" : "pointer",
                opacity: downloading ? 0.6 : 1,
              }}
            >
              {downloading ? "Exporterar…" : "⬇ Ladda ner bild " + (current + 1)}
            </button>
            <button
              onClick={handleDownloadAll}
              disabled={downloadingAll}
              style={{
                background: "rgba(255,139,1,0.15)",
                color: "#FF8B01",
                border: "1px solid rgba(255,139,1,0.3)",
                borderRadius: "20px",
                padding: "10px 20px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: downloadingAll ? "wait" : "pointer",
                opacity: downloadingAll ? 0.6 : 1,
              }}
            >
              {downloadingAll ? "Exporterar alla…" : "⬇ Ladda ner alla 6"}
            </button>
          </div>
        </div>

        {/* Slide dots */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "20px",
            flexWrap: "wrap",
          }}
        >
          {slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrent(i)}
              style={{
                background: i === current ? "#FF8B01" : "rgba(255,255,255,0.12)",
                color: i === current ? "#000" : "rgba(255,255,255,0.5)",
                border: "none",
                borderRadius: "12px",
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {s.id}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div
        style={{
          position: "relative",
          boxShadow: "0 0 80px rgba(255,139,1,0.08), 0 40px 120px rgba(0,0,0,0.8)",
          borderRadius: device === "ipad" ? "24px" : device === "watch" ? "60px" : "50px",
          transform: device === "ipad" ? "scale(0.55)" : "scale(1)",
          transformOrigin: "top center",
          marginBottom: device === "ipad" ? "-580px" : "0",
        }}
      >
        {device === "iphone" ? (
          <Slide
            key={`iphone-${current}`}
            slide={SLIDES[current]}
            slideRef={slideRef as React.RefObject<HTMLDivElement>}
          />
        ) : device === "ipad" ? (
          <IPadSlide
            key={`ipad-${current}`}
            slide={SLIDES[current]}
            slideRef={slideRef as React.RefObject<HTMLDivElement>}
          />
        ) : (
          <WatchSlide
            key={`watch-${current}`}
            slide={WATCH_SLIDES[current]}
            slideRef={slideRef as React.RefObject<HTMLDivElement>}
          />
        )}
      </div>

      {/* Navigation */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          marginTop: "28px",
          alignItems: "center",
        }}
      >
        <button
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          disabled={current === 0}
          style={{
            background: "rgba(255,255,255,0.08)",
            color: current === 0 ? "rgba(255,255,255,0.2)" : "#fff",
            border: "none",
            borderRadius: "50%",
            width: "44px",
            height: "44px",
            fontSize: "18px",
            cursor: current === 0 ? "default" : "pointer",
          }}
        >
          ←
        </button>
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>
          Bild {current + 1} av {slides.length}
        </span>
        <button
          onClick={() => setCurrent((c) => Math.min(slides.length - 1, c + 1))}
          disabled={current === slides.length - 1}
          style={{
            background: "rgba(255,255,255,0.08)",
            color: current === slides.length - 1 ? "rgba(255,255,255,0.2)" : "#fff",
            border: "none",
            borderRadius: "50%",
            width: "44px",
            height: "44px",
            fontSize: "18px",
            cursor: current === slides.length - 1 ? "default" : "pointer",
          }}
        >
          →
        </button>
      </div>

      {/* Hidden iPad renders for "download all" */}
      <div style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none" }}>
        {SLIDES.map((slide, i) => (
          <div key={`ipad-ref-${slide.id}`} ref={(el) => { allIPadRefs.current[i] = el?.firstElementChild as HTMLDivElement | null; }}>
            <IPadSlide
              slide={slide}
              slideRef={{ current: null } as unknown as React.RefObject<HTMLDivElement>}
            />
          </div>
        ))}
      </div>

      {/* Hidden Watch renders for "download all" */}
      <div style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none" }}>
        {WATCH_SLIDES.map((slide, i) => (
          <div key={`watch-ref-${slide.id}`} ref={(el) => { allWatchRefs.current[i] = el?.firstElementChild as HTMLDivElement | null; }}>
            <WatchSlide
              slide={slide}
              slideRef={{ current: null } as unknown as React.RefObject<HTMLDivElement>}
            />
          </div>
        ))}
      </div>

      {/* Hidden renders of all slides for "download all" */}
      <div style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none" }}>
        {SLIDES.map((slide, i) => (
          <div
            key={slide.id}
            ref={(el) => { allSlideRefs.current[i] = el; }}
            style={{
              width: "428px",
              height: "926px",
              background: "#0a0a0a",
              position: "relative",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
              flexShrink: 0,
            }}
          >
            <TopoBackground />
            <div
              style={{
                position: "relative",
                zIndex: 1,
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "48px 32px 36px",
                boxSizing: "border-box",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#FF8B01", marginBottom: "18px", opacity: 0.9 }}>
                Vindkollen AR
              </div>
              <h1 style={{ fontSize: "38px", fontWeight: 800, lineHeight: 1.08, color: "#ffffff", margin: 0, marginBottom: "14px", whiteSpace: "pre-line", letterSpacing: "-0.02em" }}>
                {slide.headline}
              </h1>
              <p style={{ fontSize: "14px", fontWeight: 400, lineHeight: 1.5, color: "rgba(255,255,255,0.55)", margin: 0, marginBottom: "28px", maxWidth: "320px" }}>
                {slide.subheadline}
              </p>
              <div style={{ width: "36px", height: "2px", background: "#FF8B01", borderRadius: "1px", marginBottom: "28px", opacity: 0.8 }} />
              <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
                <div style={{ width: "100%", maxWidth: "320px", margin: "0 auto" }}>
                  <IPhoneFrame imageSrc={slide.image} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "11px", marginTop: "32px", textAlign: "center" }}>
        {device === "iphone"
          ? "Tryck \"Ladda ner\" för PNG i 1284×2778 px (iPhone 6.7\")"
          : device === "ipad"
          ? "Tryck \"Ladda ner\" för PNG i 2048×2732 px (iPad Pro 12.9\")"
          : "Tryck \"Ladda ner\" för PNG i 422×514 px (Apple Watch Ultra 3)"}
      </p>
    </div>
  );
}
