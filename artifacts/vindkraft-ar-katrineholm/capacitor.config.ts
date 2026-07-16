import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "se.vindkollen.app",
  appName: "Vindkollen",
  // dist-native = output from `pnpm native:build` (vite.native.config.ts)
  webDir: "dist-native",
  bundledWebRuntime: false,
  ios: {
    contentInset: "always",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
    },
    // Krävs för att @capacitor/geolocation ska fungera korrekt på iOS/Android
    Geolocation: {},
    // Krävs för att trigga kamerabehörighetsdialogen via @capacitor/camera
    Camera: {},
  },
};

export default config;
