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
 * Körs med: pnpm native:build  (= vite build --mode native --config vite.native.config.ts)
 *
 * Miljövariabler laddas från .env.native (Vites loadEnv med mode="native").
 * Kan alltid åsidosättas med verkliga miljövariabler (CI, Xcode Cloud, etc.).
 *
 * Viktiga variabler:
 *   VITE_API_BASE_URL    — absolut HTTPS-adress till API:et (krävs för Capacitor)
 *   VITE_PUBLIC_APP_URL  — publik delningslänk-bas
 */
import { defineConfig, type Plugin } from "vite";
import fs from "fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "child_process";

/**
 * Service workers fungerar inte i Capacitor WebViews.
 * Denna stub ersätter virtual:pwa-register med en no-op så att
 * pwaUpdate.ts kompilerar utan VitePWA-plugin.
 */
function pwaStubPlugin(): Plugin {
  const VIRTUAL = "virtual:pwa-register";
  const RESOLVED = "\0" + VIRTUAL;
  return {
    name: "pwa-stub",
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED;
    },
    load(id) {
      if (id === RESOLVED) {
        return `export function registerSW() { return () => Promise.resolve(); }`;
      }
    },
  };
}

/** Hämtar git-korthashen vid byggtid, eller "dev" som fallback. */
function getGitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

/**
 * Parsar en .env-fil direkt från disk utan att blanda in process.env.
 * Vites loadEnv med prefix="" inkluderar process.env, vilket gör att
 * Repliets shell-variabel VITE_API_BASE_URL (dev-tunnel) annars åsidosätter
 * .env.native vid native-byggen.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return result;
  } catch {
    return {};
  }
}

export default defineConfig(({ mode }) => {
  // Läs .env.native direkt — utan loadEnv som blandar in process.env.
  // Filvärden har alltid prioritet; process.env används som CI-fallback
  // (Xcode Cloud, GitHub Actions) där .env.native inte finns.
  const fileEnv = parseEnvFile(
    path.resolve(import.meta.dirname, `.env.${mode}`),
  );

  const apiBase = fileEnv.VITE_API_BASE_URL || process.env.VITE_API_BASE_URL || "";
  const publicBase = fileEnv.VITE_PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || "";
  const gitHash = getGitHash();
  const buildTime = new Date().toISOString().replace("T", " ").slice(0, 16);
  const buildId = `${gitHash}@${buildTime}`;

  console.log("[native:build] mode =", mode);
  console.log("[native:build] VITE_API_BASE_URL =", apiBase || "(tom — sätts från .env.native)");
  console.log("[native:build] VITE_PUBLIC_APP_URL =", publicBase || "(tom)");
  console.log("[native:build] VITE_BUILD_ID =", buildId);

  return {
    base: "/",
    plugins: [pwaStubPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBase),
      "import.meta.env.VITE_PUBLIC_APP_URL": JSON.stringify(publicBase),
      // Build-ID: git-hash + byggtid — visas i diagnostikpanelen på iOS
      // för att bekräfta att rätt version är installerad.
      "import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId),
    },
    build: {
      outDir: path.resolve(import.meta.dirname, "dist-native"),
      emptyOutDir: true,
    },
  };
});
