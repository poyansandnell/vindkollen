/**
 * Detekterar "in-app"-webbläsare (Messenger, Instagram, TikTok, WeChat m.fl.)
 * — dessa inbäddade webbvyer saknar ofta stöd för att visa behörighets-
 * dialogen för kamera/GPS, eller nekar den direkt utan att fråga
 * användaren. Appen fungerar då inte alls, utan att det syns varför.
 */
export function isInAppBrowser(userAgent: string = navigator.userAgent): boolean {
  const ua = userAgent.toLowerCase();
  return [
    "fban", // Facebook app (iOS)
    "fbav", // Facebook app (Android)
    "fb_iab", // Facebook in-app browser
    "messenger", // Messenger app
    "instagram",
    "line/",
    "micromessenger", // WeChat
    "musical_ly",
    "tiktok",
    "snapchat",
    "linkedinapp",
    "pinterest",
    "twitter",
  ].some((marker) => ua.includes(marker));
}

/** Ett kort, mänskligt namn på den detekterade in-app-webbläsaren, för visning i UI. */
export function inAppBrowserName(userAgent: string = navigator.userAgent): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("fban") || ua.includes("fbav") || ua.includes("fb_iab")) return "Facebook";
  if (ua.includes("messenger")) return "Messenger";
  if (ua.includes("instagram")) return "Instagram";
  if (ua.includes("line/")) return "LINE";
  if (ua.includes("micromessenger")) return "WeChat";
  if (ua.includes("tiktok") || ua.includes("musical_ly")) return "TikTok";
  if (ua.includes("snapchat")) return "Snapchat";
  if (ua.includes("linkedinapp")) return "LinkedIn";
  if (ua.includes("pinterest")) return "Pinterest";
  if (ua.includes("twitter")) return "X/Twitter";
  return "appen";
}
