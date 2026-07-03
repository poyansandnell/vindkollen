import { useEffect, useState } from "react";

const DISMISS_KEY = "vindkraft-karta:install-prompt-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return Boolean(mql || iosStandalone);
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [standalone] = useState(isStandalone);
  const ios = useState(isIos)[0];

  useEffect(() => {
    if (standalone) return;

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [standalone]);

  useEffect(() => {
    if (!standalone) return;
    const handler = () => setDeferredPrompt(null);
    window.addEventListener("appinstalled", handler);
    return () => window.removeEventListener("appinstalled", handler);
  }, [standalone]);

  const canPromptAndroid = !standalone && !!deferredPrompt;
  const canHintIos = !standalone && ios && !deferredPrompt;
  const shouldShow = !dismissed && (canPromptAndroid || canHintIos);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore storage errors (private browsing etc.)
    }
    setDismissed(true);
  };

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  };

  return {
    shouldShow,
    isIos: ios,
    canPromptAndroid,
    promptInstall,
    dismiss,
  };
}
