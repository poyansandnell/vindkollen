import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    VitePWA({
      // OBS: INTE "autoUpdate". Det läget laddar om sidan automatiskt, utan
      // förvarning, så fort en ny service worker upptäcks (t.ex. direkt efter
      // en publicering) — kan trigga mitt i en pågående AR-session, precis
      // när GPS/kamera väntar på fix, vilket upplevs som att "appen startar
      // om sig själv". "prompt" registrerar/laddar ner den nya service
      // workern i bakgrunden men tar aldrig kontroll över en redan öppen
      // flik förrän användaren själv laddar om sidan (t.ex. nästa gång appen
      // öppnas) — ingen befintlig session avbryts.
      registerType: "prompt",
      // Vi registrerar service workern manuellt i src/lib/pwaUpdate.ts (via
      // `virtual:pwa-register`) för att kunna visa en egen, icke-blockerande
      // "Ny version tillgänglig"-banner istället för att antingen (a) tvinga
      // en omedelbar omladdning ("autoUpdate"-läget, se tidigare bugg) eller
      // (b) tyst göra ingenting så att nya versioner aldrig når användaren
      // (standardbeteendet för "prompt" utan egen onNeedRefresh-hantering).
      injectRegister: false,
      includeAssets: ["favicon.svg", "robots.txt", "icons/apple-touch-icon.png"],
      manifest: {
        id: basePath,
        scope: basePath,
        start_url: basePath,
        name: "Vindkraft AR Katrineholm",
        short_name: "Vindkraft AR",
        description: "Se de planerade vindkraftverken vid Länsterberget i förstärkt verklighet.",
        theme_color: "#0e2a22",
        background_color: "#0e2a22",
        display: "standalone",
        orientation: "portrait",
        lang: "sv",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallbackDenylist: [/^\/api/],
        // TensorFlow.js (för himmel-segmenteringen i useSkyDetection) gör
        // huvudbundeln större än standardgränsen på 2 MiB.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
