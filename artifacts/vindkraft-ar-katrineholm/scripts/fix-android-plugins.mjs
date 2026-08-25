/**
 * Android must use WebView getUserMedia for AR camera access.
 *
 * Capacitor discovers every installed plugin during `cap sync android`. The
 * Camera and CameraPreview packages are retained for iOS, but their Android
 * implementations are unsafe for this app's target SDK and must not be
 * registered in an Android release. This script is deliberately run after
 * every Android sync, because Capacitor regenerates these files.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(scriptDir, "..");
const androidDir = path.join(artifactDir, "android");

const blockedPackages = new Set([
  "@capacitor/camera",
  "@capacitor-community/camera-preview",
]);
const blockedProjects = [
  "capacitor-camera",
  "capacitor-community-camera-preview",
];

const pluginsPath = path.join(androidDir, "app/src/main/assets/capacitor.plugins.json");
const buildGradlePath = path.join(androidDir, "app/capacitor.build.gradle");
const settingsGradlePath = path.join(androidDir, "capacitor.settings.gradle");

const plugins = JSON.parse(await readFile(pluginsPath, "utf8"));
const filteredPlugins = plugins.filter((plugin) => !blockedPackages.has(plugin.pkg));
if (filteredPlugins.length === plugins.length) {
  console.log("[fix-android-plugins] Camera plugins were already absent.");
} else {
  await writeFile(pluginsPath, `${JSON.stringify(filteredPlugins, null, 2)}\n`);
  console.log("[fix-android-plugins] Removed Camera and CameraPreview from capacitor.plugins.json.");
}

let buildGradle = await readFile(buildGradlePath, "utf8");
for (const projectName of blockedProjects) {
  buildGradle = buildGradle.replaceAll(`    implementation project(':${projectName}')\n`, "");
}
await writeFile(buildGradlePath, buildGradle);

let settingsGradle = await readFile(settingsGradlePath, "utf8");
for (const projectName of blockedProjects) {
  const escaped = projectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const projectBlock = new RegExp(
    `\\ninclude ':${escaped}'\\nproject\\(':${escaped}'\\)\\.projectDir = new File\\([^\\n]+\\)\\n`,
    "g",
  );
  settingsGradle = settingsGradle.replace(projectBlock, "\n");
}
await writeFile(settingsGradlePath, settingsGradle);

const [verifiedPlugins, verifiedBuildGradle, verifiedSettingsGradle] = await Promise.all([
  readFile(pluginsPath, "utf8"),
  readFile(buildGradlePath, "utf8"),
  readFile(settingsGradlePath, "utf8"),
]);
const generatedAndroidFiles = [verifiedPlugins, verifiedBuildGradle, verifiedSettingsGradle].join("\n");

for (const blocked of [...blockedPackages, ...blockedProjects]) {
  if (generatedAndroidFiles.includes(blocked)) {
    throw new Error(`[fix-android-plugins] ${blocked} remains registered for Android.`);
  }
}

console.log("[fix-android-plugins] Android plugin registry contains no native camera plugins.");