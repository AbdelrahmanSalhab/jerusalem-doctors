"use client";

// Lightweight Cloudflare Turnstile renderer. No npm package — loads the
// official script once and uses the explicit-render API.
//
// Tokens are single-use; once the server has verified one, the widget needs
// to be reset to issue a fresh token. The parent calls
// `turnstileRef.current?.reset()` after each form submission to do this.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

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
      appearance?: "always" | "execute" | "interaction-only";
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

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface TurnstileHandle {
  reset: () => void;
}

interface Props {
  onToken: (token: string) => void;
  action?: string;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, Props>(
  function TurnstileWidget({ onToken, action }, ref) {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [scriptReady, setScriptReady] = useState(
      typeof window !== "undefined" && Boolean(window.turnstile),
    );

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          onToken("");
          if (widgetIdRef.current && window.turnstile) {
            try {
              window.turnstile.reset(widgetIdRef.current);
            } catch {
              // widget gone — ignore
            }
          }
        },
      }),
      [onToken],
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
      if (!scriptReady || !containerRef.current || !siteKey || !window.turnstile)
        return;
      const id = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
        action,
        theme: "auto",
        // Stay invisible while passive checks run — only render the
        // challenge UI if a user interaction is actually required. Prevents
        // the "Verifying..." overlay from briefly capturing page focus on
        // privacy-strict browsers (Brave etc.).
        appearance: "interaction-only",
      });
      widgetIdRef.current = id;
      return () => {
        try {
          window.turnstile?.remove(id);
        } catch {
          // already gone
        }
        widgetIdRef.current = null;
      };
    }, [scriptReady, siteKey, onToken, action]);

    if (!siteKey) return null;
    return (
      <div className="flex justify-center py-1">
        <div ref={containerRef} className="cf-turnstile" />
      </div>
    );
  },
);
