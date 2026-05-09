"use client";

// Lightweight Cloudflare Turnstile renderer. No npm package — loads the
// official script once and uses the explicit-render API. Renders nothing
// when NEXT_PUBLIC_TURNSTILE_SITE_KEY isn't set, so dev keeps working
// without any Cloudflare account.

import { useEffect, useRef, useState } from "react";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      action?: string;
    },
  ) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function TurnstileWidget({
  onToken,
  action,
}: {
  onToken: (token: string) => void;
  action?: string;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const ref = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(
    typeof window !== "undefined" && Boolean(window.turnstile),
  );

  useEffect(() => {
    if (!siteKey) return;
    if (window.turnstile) {
      setScriptReady(true);
      return;
    }
    const existing = document.querySelector(
      `script[src="${SCRIPT_SRC}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => setScriptReady(true));
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => setScriptReady(true);
    document.head.appendChild(script);
  }, [siteKey]);

  useEffect(() => {
    if (!scriptReady || !ref.current || !siteKey || !window.turnstile) return;
    const widgetId = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
      action,
      theme: "auto",
    });
    return () => {
      try {
        window.turnstile?.remove(widgetId);
      } catch {
        // widget already gone — ignore
      }
    };
  }, [scriptReady, siteKey, onToken, action]);

  if (!siteKey) return null;
  return <div ref={ref} className="cf-turnstile" />;
}
