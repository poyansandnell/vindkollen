import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "se.catchme.vindkollen",
  appName: "Vindkollen",
  // dist-native = output from `pnpm native:build` (vite.native.config.ts)
  webDir: "dist-native",
  bundledWebRuntime: false,
  ios: {
    contentInset: "never",
    // Gör WKWebView transparent så att native CameraPreview-lagret bakom syns igenom.
    // Krävs tillsammans med CameraPreview.start({ toBack: true }) och att alla
    // HTML-element saknar ogenomskinlig bakgrundsfärg när kameran är aktiv.
    backgroundColor: "#00000000",
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
