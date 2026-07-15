/**
 * Vite-konfiguration för native-byggen (Capacitor iOS/Android).
 *
 * Skillnader mot vite.config.ts:
 * - Kräver inte PORT eller BASE_PATH (ingen dev-server)
 * - base: "/" (inte sökvägsprefix)
 * - outDir: dist-native (capacitor.config.ts pekar hit)
 * - Ingen PWA-plugin (service workers fungerar annorlunda i Capacitor)
 * - Ingen Replit-specifik dev-banner
 *
 * Bygg: pnpm native:build
 * API-adress: Sätt VITE_API_BASE_URL=https://din-produktion.repl.co i env
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  define: {
    // Gör att import.meta.env.VITE_API_BASE_URL finns vid byggtid
    // Sätt via: VITE_API_BASE_URL=https://... pnpm native:build
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(
      process.env.VITE_API_BASE_URL ?? "",
    ),
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist-native"),
    emptyOutDir: true,
  },
});
