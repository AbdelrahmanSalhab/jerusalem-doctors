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
  /**
   * Resolves with a fresh Turnstile token. If a token is already cached,
   * resolves immediately. Otherwise waits for the next `callback` from the
   * widget — when `appearance: "interaction-only"` + passive checks pass,
   * this is usually milliseconds.
   */
  getToken: (timeoutMs?: number) => Promise<string>;
}

interface Props {
  onToken: (token: string) => void;
  action?: string;
}

interface InternalState {
  currentToken: string;
  pendingResolvers: Array<(t: string) => void>;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, Props>(
  function TurnstileWidget({ onToken, action }, ref) {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    // Wraps onToken with a resolver queue so callers can `await getToken()`.
    const stateRef = useRef<InternalState>({
      currentToken: "",
      pendingResolvers: [],
    });
    const [scriptReady, setScriptReady] = useState(
      typeof window !== "undefined" && Boolean(window.turnstile),
    );

    const internalOnToken = useRef(onToken);
    internalOnToken.current = onToken;

    const handleToken = useRef((t: string) => {
      stateRef.current.currentToken = t;
      if (t) {
        const queued = stateRef.current.pendingResolvers;
        stateRef.current.pendingResolvers = [];
        for (const r of queued) r(t);
      }
      internalOnToken.current(t);
    });

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          stateRef.current.currentToken = "";
          internalOnToken.current("");
          if (widgetIdRef.current && window.turnstile) {
            try {
              window.turnstile.reset(widgetIdRef.current);
            } catch {
              // widget gone — ignore
            }
          }
        },
        getToken: (timeoutMs = 5000) => {
          if (stateRef.current.currentToken) {
            return Promise.resolve(stateRef.current.currentToken);
          }
          return new Promise<string>((resolve, reject) => {
            const wrapped = (t: string) => {
              clearTimeout(timer);
              resolve(t);
            };
            const timer = setTimeout(() => {
              const idx =
                stateRef.current.pendingResolvers.indexOf(wrapped);
              if (idx >= 0) stateRef.current.pendingResolvers.splice(idx, 1);
              reject(new Error("turnstile timeout"));
            }, timeoutMs);
            stateRef.current.pendingResolvers.push(wrapped);
          });
        },
      }),
      [],
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
        callback: (t) => handleToken.current(t),
        "expired-callback": () => handleToken.current(""),
        "error-callback": () => handleToken.current(""),
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
    }, [scriptReady, siteKey, action]);

    if (!siteKey) return null;
    return (
      <div className="flex justify-center py-1">
        <div ref={containerRef} className="cf-turnstile" />
      </div>
    );
  },
);
