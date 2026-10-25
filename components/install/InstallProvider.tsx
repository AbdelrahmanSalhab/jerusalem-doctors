"use client";

// Installing the directory to the home screen, for the whole site: lives in
// the root layout so Android's install event, which fires once and early,
// survives moving between pages. Gives the account menu and the dashboard's
// invitation one shared state:
//   - canPrompt: a native install prompt is ready (Chromium only)
//   - standalone: this window is the installed app, so nothing is offered
//   - guide: which manual instructions fit this browser (lib/install)
// and one instructions dialog for every browser without a native prompt.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { InstallHelpDialog } from "@/components/install/InstallHelpDialog";
import { INSTALL_READY_EVENT, installGuideFor, type InstallGuide } from "@/lib/install/context";

/** Chromium's install event (not in TypeScript's DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallState {
  /** False until the browser has been read (the server render knows nothing). */
  ready: boolean;
  standalone: boolean;
  /** Installed during this visit (appinstalled): nothing more to offer here. */
  installed: boolean;
  canPrompt: boolean;
  /** The native prompt is open: the button must not open it again. */
  prompting: boolean;
  guide: InstallGuide;
  /** The native prompt where there is one, else the instructions. */
  install: () => void;
  openHelp: () => void;
}

const InstallContext = createContext<InstallState | null>(null);

export const useInstall = () => useContext(InstallContext);

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallProvider({ children }: { children: React.ReactNode }) {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState({
    ready: false,
    standalone: false,
    installed: false,
    canPrompt: false,
    prompting: false,
    guide: "other" as InstallGuide,
  });
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const touchMac = navigator.maxTouchPoints > 1;
    const update = () => setState((s) => ({ ...s, ready: true, standalone: isStandalone() }));
    // Browser-only facts, read after mount so the server render matches.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, ready: true, standalone: isStandalone(), guide: installGuideFor(navigator.userAgent, touchMac) }));

    // The <head> script (INSTALL_CAPTURE_SCRIPT) keeps the event for our
    // own button rather than the browser's small bar, whenever it came.
    const take = () => {
      const w = window as Window & { __jdInstall?: BeforeInstallPromptEvent | null };
      if (!w.__jdInstall) return;
      deferred.current = w.__jdInstall;
      w.__jdInstall = null;
      setState((s) => ({ ...s, canPrompt: true }));
    };
    take();
    const onInstalled = () => {
      deferred.current = null;
      setState((s) => ({ ...s, canPrompt: false, installed: true }));
      setHelpOpen(false);
    };
    // The window can become the app (or stop being it) while open.
    const media = window.matchMedia("(display-mode: standalone)");
    const onVisible = () => document.visibilityState === "visible" && update();

    window.addEventListener(INSTALL_READY_EVENT, take);
    window.addEventListener("appinstalled", onInstalled);
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(INSTALL_READY_EVENT, take);
      window.removeEventListener("appinstalled", onInstalled);
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const openHelp = useCallback(() => setHelpOpen(true), []);

  const install = useCallback(async () => {
    const event = deferred.current;
    if (!event) {
      setHelpOpen(true);
      return;
    }
    // An event opens the prompt once; a second tap must not try again.
    deferred.current = null;
    setState((s) => ({ ...s, canPrompt: false, prompting: true }));
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      // The browser refused (it decides eligibility): offer the manual way.
      setHelpOpen(true);
    } finally {
      setState((s) => ({ ...s, prompting: false }));
    }
  }, []);

  return (
    <InstallContext.Provider value={{ ...state, install, openHelp }}>
      {children}
      <InstallHelpDialog open={helpOpen} guide={state.guide} onClose={() => setHelpOpen(false)} />
    </InstallContext.Provider>
  );
}
