"use client";

// Who is looking at the directory, so contact buttons can introduce them.

import { createContext, useContext } from "react";
import type { Viewer } from "@/lib/contactIntro";

const ViewerContext = createContext<Viewer | null>(null);

export function ViewerProvider({ viewer, children }: { viewer: Viewer; children: React.ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

export const useViewer = () => useContext(ViewerContext);
