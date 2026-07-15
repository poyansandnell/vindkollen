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
 * API-adress:    VITE_API_BASE_URL=https://app.vindkollen.com
 * Publik URL:    VITE_PUBLIC_APP_URL=https://app.vindkollen.com
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
    // Injiceras vid byggtid. Exempel:
    //   VITE_API_BASE_URL=https://app.vindkollen.com pnpm native:build
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(
      process.env.VITE_API_BASE_URL ?? "",
    ),
    "import.meta.env.VITE_PUBLIC_APP_URL": JSON.stringify(
      process.env.VITE_PUBLIC_APP_URL ?? "",
    ),
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist-native"),
    emptyOutDir: true,
  },
});
