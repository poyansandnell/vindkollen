import { useState, useRef, useCallback } from "react";

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
  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const slideRef = useRef<HTMLDivElement>(null);
  const allSlideRefs = useRef<(HTMLDivElement | null)[]>([]);

  const handleDownload = useCallback(async () => {
    if (!slideRef.current) return;
    setDownloading(true);
    try {
      await downloadSlide(
        slideRef.current,
        SLIDES[current].filename,
        3
      );
    } finally {
      setDownloading(false);
    }
  }, [current]);

  const handleDownloadAll = useCallback(async () => {
    setDownloadingAll(true);
    try {
      for (let i = 0; i < SLIDES.length; i++) {
        const el = allSlideRefs.current[i];
        if (!el) continue;
        await downloadSlide(el, SLIDES[i].filename, 3);
        await new Promise((r) => setTimeout(r, 600));
      }
    } finally {
      setDownloadingAll(false);
    }
  }, []);

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
              {current + 1} / {SLIDES.length} · 428 × 926 px (3× = 1284 × 2778)
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
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
          {SLIDES.map((s, i) => (
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
          borderRadius: "50px",
        }}
      >
        <Slide
          key={current}
          slide={SLIDES[current]}
          slideRef={slideRef as React.RefObject<HTMLDivElement>}
        />
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
          Bild {current + 1} av {SLIDES.length}
        </span>
        <button
          onClick={() => setCurrent((c) => Math.min(SLIDES.length - 1, c + 1))}
          disabled={current === SLIDES.length - 1}
          style={{
            background: "rgba(255,255,255,0.08)",
            color: current === SLIDES.length - 1 ? "rgba(255,255,255,0.2)" : "#fff",
            border: "none",
            borderRadius: "50%",
            width: "44px",
            height: "44px",
            fontSize: "18px",
            cursor: current === SLIDES.length - 1 ? "default" : "pointer",
          }}
        >
          →
        </button>
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
        Tryck "Ladda ner" för PNG i 1284×2778 px (Apples godkända format för App Store)
      </p>
    </div>
  );
}
