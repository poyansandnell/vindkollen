import { useState, useRef, useCallback } from "react";

type Mode = "phone" | "tablet" | "feature";

const SLIDES = [
  {
    id: 1,
    headline: "Se framtidens\nvindkraft\nredan idag",
    subheadline: "Visualisera vindkraftverk direkt i den verkliga miljön med hjälp av AR.",
    image: "/appstore/ar-dagsljus.png",
    filename: "vindkollen-android-1-ar-dagsljus.png",
  },
  {
    id: 2,
    headline: "Upplev vindkraft\n– dag och natt",
    subheadline: "Se hur landskapet förändras under olika tider på dygnet.",
    image: "/appstore/ar-kvall-tak.png",
    filename: "vindkollen-android-2-ar-kvall.png",
  },
  {
    id: 3,
    headline: "Se utsikten\nfrån din\negen plats",
    subheadline: "Placera dig där du bor och upplev hur vindkraftverken kan komma att synas.",
    image: "/appstore/ar-natt-gata.png",
    filename: "vindkollen-android-3-ar-natt.png",
  },
  {
    id: 4,
    headline: "Utforska hela\nSveriges\nvindkraft",
    subheadline: "Över 3 500 projekt och mer än 13 000 vindkraftverk samlade på en interaktiv karta.",
    image: "/appstore/sverigekartan.png",
    filename: "vindkollen-android-4-sverigekartan.png",
  },
  {
    id: 5,
    headline: "Analysera\ninnan beslut\nfattas",
    subheadline: "Flytta verk, jämför placeringar och se hur olika alternativ påverkar omgivningen.",
    image: "/appstore/redigering.png",
    filename: "vindkollen-android-5-redigering.png",
  },
  {
    id: 6,
    headline: "Kom igång\npå några\nsekunder",
    subheadline: "Öppna kartan eller starta AR direkt och börja utforska.",
    image: "/appstore/start.png",
    filename: "vindkollen-android-6-start.png",
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
];

// ── Android phone frame — punch-hole, no Dynamic Island ──────────────────────

function AndroidFrame({ imageSrc }: { imageSrc: string }) {
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "9/16",
        borderRadius: "36px",
        border: "5px solid #2a2a2a",
        boxShadow:
          "0 0 0 1px #3a3a3a, inset 0 0 0 1px #1a1a1a, 0 40px 120px rgba(0,0,0,0.9), 0 8px 32px rgba(0,0,0,0.6)",
        overflow: "hidden",
        position: "relative",
        background: "#000",
      }}
    >
      {/* Punch-hole camera */}
      <div
        style={{
          position: "absolute",
          top: "14px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "12px",
          height: "12px",
          background: "#000",
          borderRadius: "50%",
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

// ── Topo SVG background ──────────────────────────────────────────────────────

function TopoBackground({ w, h, gradientId }: { w: number; h: number; gradientId: string }) {
  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="35%" r="55%">
          <stop offset="0%" stopColor="#FF8B01" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#FF8B01" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#${gradientId})`} />
      {[0, 1, 2].map((rep) =>
        TOPO_PATHS.map((d, i) => (
          <path
            key={`${rep}-${i}`}
            d={d.replace(/(\d+),(\d+)/g, (_, x, y) =>
              `${(parseInt(x) * w) / 1390},${parseInt(y) + rep * 1100}`
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

// ── Phone screenshot slide — 540×960 @ 2x = 1080×1920 ───────────────────────

function PhoneSlide({
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
        width: "540px",
        height: "960px",
        background: "#0a0a0a",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily:
          "'Google Sans', 'Roboto', 'Helvetica Neue', Arial, sans-serif",
        flexShrink: 0,
      }}
    >
      <TopoBackground w={540} h={960} gradientId="glow-phone" />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "52px 36px 40px",
          boxSizing: "border-box",
        }}
      >
        {/* Brand */}
        <div
          style={{
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase" as const,
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
            fontSize: "40px",
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
            lineHeight: 1.55,
            color: "rgba(255,255,255,0.55)",
            margin: 0,
            marginBottom: "24px",
            maxWidth: "340px",
          }}
        >
          {slide.subheadline}
        </p>

        {/* Accent line */}
        <div
          style={{
            width: "36px",
            height: "2px",
            background: "#FF8B01",
            borderRadius: "1px",
            marginBottom: "24px",
            opacity: 0.8,
          }}
        />

        {/* Android phone with screenshot */}
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", maxWidth: "300px", margin: "0 auto" }}>
            <AndroidFrame imageSrc={slide.image} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tablet frame — portrait 9:16, thicker bezels than phone ─────────────────

function TabletFrame({ imageSrc }: { imageSrc: string }) {
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "9/16",
        borderRadius: "28px",           // squarer corners than phone
        border: "8px solid #252525",    // thicker bezel
        boxShadow:
          "0 0 0 2px #333, inset 0 0 0 1px #1a1a1a, 0 40px 120px rgba(0,0,0,0.9), 0 8px 32px rgba(0,0,0,0.6)",
        overflow: "hidden",
        position: "relative",
        background: "#000",
      }}
    >
      {/* Front camera — centred top, no Dynamic Island */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "10px",
          height: "10px",
          background: "#111",
          borderRadius: "50%",
          zIndex: 10,
          border: "1px solid #333",
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

// ── Tablet slide — portrait 9:16, 540×960 @ 2x = 1080×1920 ─────────────────

function TabletSlide({
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
        width: "540px",
        height: "960px",
        background: "#0a0a0a",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "'Google Sans', 'Roboto', 'Helvetica Neue', Arial, sans-serif",
        flexShrink: 0,
      }}
    >
      <TopoBackground w={540} h={960} gradientId="glow-tablet" />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "52px 36px 40px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "#FF8B01", marginBottom: "18px", opacity: 0.9 }}>
          Vindkollen AR
        </div>
        <h1 style={{ fontSize: "40px", fontWeight: 800, lineHeight: 1.08, color: "#ffffff", margin: 0, marginBottom: "14px", whiteSpace: "pre-line", letterSpacing: "-0.02em" }}>
          {slide.headline}
        </h1>
        <p style={{ fontSize: "14px", fontWeight: 400, lineHeight: 1.55, color: "rgba(255,255,255,0.55)", margin: 0, marginBottom: "24px", maxWidth: "340px" }}>
          {slide.subheadline}
        </p>
        <div style={{ width: "36px", height: "2px", background: "#FF8B01", borderRadius: "1px", marginBottom: "24px", opacity: 0.8 }} />

        <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", maxWidth: "310px", margin: "0 auto" }}>
            <TabletFrame imageSrc={slide.image} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Feature graphic — 1024×500 ───────────────────────────────────────────────

function FeatureGraphic({ graphicRef }: { graphicRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div
      ref={graphicRef}
      style={{
        width: "1024px",
        height: "500px",
        background: "#0a0a0a",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        fontFamily:
          "'Google Sans', 'Roboto', 'Helvetica Neue', Arial, sans-serif",
        flexShrink: 0,
      }}
    >
      {/* Background image fills right 60% */}
      <img
        src="/android/feature-graphic-1024x500.png"
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
        }}
      />

      {/* Dark left overlay for text */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to right, rgba(10,10,10,0.98) 0%, rgba(10,10,10,0.85) 40%, rgba(10,10,10,0.2) 65%, transparent 100%)",
        }}
      />

      {/* Topo lines on left */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        viewBox="0 0 1024 500"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        {TOPO_PATHS.slice(0, 8).map((d, i) => (
          <path
            key={i}
            d={d.replace(/(\d+),(\d+)/g, (_, x, y) =>
              `${(parseInt(x) * 1024) / 1390},${parseInt(y) * 0.36}`
            )}
            fill="none"
            stroke="#FF8B01"
            strokeWidth="1"
            strokeOpacity="0.06"
          />
        ))}
      </svg>

      {/* Text content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "0 64px",
          maxWidth: "480px",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase" as const,
            color: "#FF8B01",
            marginBottom: "16px",
            opacity: 0.9,
          }}
        >
          Vindkollen AR
        </div>
        <h1
          style={{
            fontSize: "52px",
            fontWeight: 800,
            lineHeight: 1.05,
            color: "#ffffff",
            margin: 0,
            marginBottom: "16px",
            letterSpacing: "-0.025em",
          }}
        >
          Se vindkraft i verkligheten
        </h1>
        <div
          style={{
            width: "40px",
            height: "3px",
            background: "#FF8B01",
            borderRadius: "2px",
            marginBottom: "16px",
          }}
        />
        <p
          style={{
            fontSize: "17px",
            fontWeight: 400,
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.6)",
            margin: 0,
          }}
        >
          Utforska 13 000+ vindkraftverk i AR — direkt i din omgivning.
        </p>
      </div>
    </div>
  );
}

// ── Download helpers ─────────────────────────────────────────────────────────

async function downloadEl(el: HTMLDivElement, filename: string, scale = 2) {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, {
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AndroidPlayScreenshots() {
  const [mode, setMode] = useState<Mode>("phone");
  const [current, setCurrent] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const slideRef    = useRef<HTMLDivElement>(null);
  const featureRef  = useRef<HTMLDivElement>(null);
  const allPhoneRefs  = useRef<(HTMLDivElement | null)[]>([]);
  const allTabletRefs = useRef<(HTMLDivElement | null)[]>([]);

  const isFeature = mode === "feature";
  const isTablet  = mode === "tablet";
  const isPhone   = mode === "phone";

  const dimLabel = isFeature
    ? "1024 × 500 px"
    : "540 × 960 px (2× = 1080 × 1920, 9:16)";

  const tabletFilename = (s: (typeof SLIDES)[0]) =>
    s.filename.replace("android-", "android-tablet-");

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      if (isFeature && featureRef.current) {
        await downloadEl(featureRef.current, "vindkollen-feature-graphic-1024x500.png", 1);
      } else if (slideRef.current) {
        const fn = isTablet
          ? tabletFilename(SLIDES[current])
          : SLIDES[current].filename;
        await downloadEl(slideRef.current, fn, 2);
      }
    } catch (err) {
      console.warn("[AndroidPlayScreenshots] download failed:", err);
    } finally {
      setDownloading(false);
    }
  }, [mode, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownloadAll = useCallback(async () => {
    setDownloadingAll(true);
    try {
      const refs = isTablet ? allTabletRefs : allPhoneRefs;
      for (let i = 0; i < SLIDES.length; i++) {
        const el = refs.current[i];
        if (!el) continue;
        const fn = isTablet ? tabletFilename(SLIDES[i]) : SLIDES[i].filename;
        await downloadEl(el, fn, 2);
        await new Promise((r) => setTimeout(r, 600));
      }
    } catch (err) {
      console.warn("[AndroidPlayScreenshots] download-all failed:", err);
    } finally {
      setDownloadingAll(false);
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const MODES: { id: Mode; label: string }[] = [
    { id: "phone",   label: "📱 Telefon" },
    { id: "tablet",  label: "📟 Surfplatta 7\"" },
    { id: "feature", label: "🖼 Feature graphic" },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#050505",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "32px 16px",
        fontFamily: "'Google Sans', 'Roboto', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ width: "100%", maxWidth: "960px", marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ color: "#fff", fontSize: "20px", fontWeight: 700, margin: 0 }}>
              Google Play — marknadsföringsbilder
            </h2>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px", margin: "4px 0 0" }}>
              {isFeature ? "1" : `${current + 1} / ${SLIDES.length}`} · {dimLabel}
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            {/* Mode toggle */}
            <div style={{ display: "flex", borderRadius: "20px", overflow: "hidden", border: "1px solid rgba(255,139,1,0.25)" }}>
              {MODES.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => { setMode(id); setCurrent(0); }}
                  style={{
                    background: mode === id ? "#FF8B01" : "transparent",
                    color: mode === id ? "#000" : "rgba(255,255,255,0.5)",
                    border: "none",
                    padding: "8px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap" as const,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{ background: "#FF8B01", color: "#000", border: "none", borderRadius: "20px", padding: "10px 20px", fontSize: "13px", fontWeight: 600, cursor: downloading ? "wait" : "pointer", opacity: downloading ? 0.6 : 1 }}
            >
              {downloading ? "Exporterar…" : isFeature ? "⬇ Feature graphic" : `⬇ Bild ${current + 1}`}
            </button>

            {!isFeature && (
              <button
                onClick={handleDownloadAll}
                disabled={downloadingAll}
                style={{ background: "rgba(255,139,1,0.15)", color: "#FF8B01", border: "1px solid rgba(255,139,1,0.3)", borderRadius: "20px", padding: "10px 20px", fontSize: "13px", fontWeight: 600, cursor: downloadingAll ? "wait" : "pointer", opacity: downloadingAll ? 0.6 : 1 }}
              >
                {downloadingAll ? "Exporterar alla…" : "⬇ Alla 6"}
              </button>
            )}
          </div>
        </div>

        {/* Slide dots */}
        {!isFeature && (
          <div style={{ display: "flex", gap: "8px", marginTop: "20px", flexWrap: "wrap" }}>
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrent(i)}
                style={{ background: i === current ? "#FF8B01" : "rgba(255,255,255,0.12)", color: i === current ? "#000" : "rgba(255,255,255,0.5)", border: "none", borderRadius: "12px", padding: "6px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
              >
                {s.id}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Preview */}
      <div
        style={{
          boxShadow: "0 0 80px rgba(255,139,1,0.08), 0 40px 120px rgba(0,0,0,0.8)",
          borderRadius: isFeature ? "12px" : isTablet ? "20px" : "46px",
          overflow: "hidden",
          transform: isFeature ? "scale(0.75)" : isTablet ? "scale(0.72)" : "scale(0.85)",
          transformOrigin: "top center",
          marginBottom: isFeature ? "-125px" : isTablet ? "-150px" : "-80px",
        }}
      >
        {isFeature ? (
          <FeatureGraphic graphicRef={featureRef as React.RefObject<HTMLDivElement>} />
        ) : isTablet ? (
          <TabletSlide
            key={`tablet-${current}`}
            slide={SLIDES[current]}
            slideRef={slideRef as React.RefObject<HTMLDivElement>}
          />
        ) : (
          <PhoneSlide
            key={`phone-${current}`}
            slide={SLIDES[current]}
            slideRef={slideRef as React.RefObject<HTMLDivElement>}
          />
        )}
      </div>

      {/* Navigation */}
      {!isFeature && (
        <div style={{ display: "flex", gap: "16px", marginTop: "28px", alignItems: "center" }}>
          <button onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}
            style={{ background: "rgba(255,255,255,0.08)", color: current === 0 ? "rgba(255,255,255,0.2)" : "#fff", border: "none", borderRadius: "50%", width: "44px", height: "44px", fontSize: "18px", cursor: current === 0 ? "default" : "pointer" }}>
            ←
          </button>
          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>Bild {current + 1} av {SLIDES.length}</span>
          <button onClick={() => setCurrent((c) => Math.min(SLIDES.length - 1, c + 1))} disabled={current === SLIDES.length - 1}
            style={{ background: "rgba(255,255,255,0.08)", color: current === SLIDES.length - 1 ? "rgba(255,255,255,0.2)" : "#fff", border: "none", borderRadius: "50%", width: "44px", height: "44px", fontSize: "18px", cursor: current === SLIDES.length - 1 ? "default" : "pointer" }}>
            →
          </button>
        </div>
      )}

      {/* Hidden phone renders */}
      <div style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none" }}>
        {SLIDES.map((slide, i) => (
          <div key={`hp-${slide.id}`} ref={(el) => { allPhoneRefs.current[i] = el; }}
            style={{ width: "540px", height: "960px", background: "#0a0a0a", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "'Google Sans','Roboto',sans-serif", flexShrink: 0 }}>
            <TopoBackground w={540} h={960} gradientId={`glow-hp-${i}`} />
            <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "52px 36px 40px", boxSizing: "border-box" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "#FF8B01", marginBottom: "18px", opacity: 0.9 }}>Vindkollen AR</div>
              <h1 style={{ fontSize: "40px", fontWeight: 800, lineHeight: 1.08, color: "#fff", margin: 0, marginBottom: "14px", whiteSpace: "pre-line", letterSpacing: "-0.02em" }}>{slide.headline}</h1>
              <p style={{ fontSize: "14px", lineHeight: 1.55, color: "rgba(255,255,255,0.55)", margin: 0, marginBottom: "24px", maxWidth: "340px" }}>{slide.subheadline}</p>
              <div style={{ width: "36px", height: "2px", background: "#FF8B01", borderRadius: "1px", marginBottom: "24px", opacity: 0.8 }} />
              <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
                <div style={{ width: "100%", maxWidth: "300px", margin: "0 auto" }}><AndroidFrame imageSrc={slide.image} /></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Hidden tablet renders — portrait 9:16, same layout as TabletSlide */}
      <div style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none" }}>
        {SLIDES.map((slide, i) => (
          <div key={`ht-${slide.id}`} ref={(el) => { allTabletRefs.current[i] = el; }}
            style={{ width: "540px", height: "960px", background: "#0a0a0a", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "'Google Sans','Roboto',sans-serif", flexShrink: 0 }}>
            <TopoBackground w={540} h={960} gradientId={`glow-ht-${i}`} />
            <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "52px 36px 40px", boxSizing: "border-box" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "#FF8B01", marginBottom: "18px", opacity: 0.9 }}>Vindkollen AR</div>
              <h1 style={{ fontSize: "40px", fontWeight: 800, lineHeight: 1.08, color: "#fff", margin: 0, marginBottom: "14px", whiteSpace: "pre-line", letterSpacing: "-0.02em" }}>{slide.headline}</h1>
              <p style={{ fontSize: "14px", lineHeight: 1.55, color: "rgba(255,255,255,0.55)", margin: 0, marginBottom: "24px", maxWidth: "340px" }}>{slide.subheadline}</p>
              <div style={{ width: "36px", height: "2px", background: "#FF8B01", borderRadius: "1px", marginBottom: "24px", opacity: 0.8 }} />
              <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
                <div style={{ width: "100%", maxWidth: "310px", margin: "0 auto" }}>
                  <TabletFrame imageSrc={slide.image} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "11px", marginTop: "32px", textAlign: "center" }}>
        {isFeature ? "Feature graphic — PNG 1024×500 px"
          : isTablet ? "Surfplatta 7\" — PNG 1920×1080 px (16:9, uppfyller Google Play minimikrav)"
          : "Telefon — PNG 1080×1920 px (9:16, uppfyller Google Play minimikrav)"}
      </p>

      <div style={{ marginTop: "24px", padding: "16px 24px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", maxWidth: "500px", textAlign: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", margin: 0 }}>
          <strong style={{ color: "rgba(255,255,255,0.8)" }}>App-ikon (512×512 px)</strong>
          {" "}— finns under{" "}
          <code style={{ color: "#FF8B01", fontSize: "11px" }}>public/android/icon-512.png</code>
          {" "}i projektet
        </p>
      </div>
    </div>
  );
}
