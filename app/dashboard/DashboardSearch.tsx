"use client";

import { useEffect, useRef, useState } from "react";
import { DoctorCard } from "@/components/DoctorCard";
import { DoctorRow } from "@/components/DoctorRow";
import type { SearchHit } from "@/app/api/search/route";

type Specialty = { id: string; name_ar: string };
type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; results: SearchHit[]; q: string }
  | { status: "error"; message: string };

type ViewMode = "cards" | "rows";

const DEBOUNCE_MS = 250;
const VIEW_STORAGE_KEY = "search:view";

export function DashboardSearch({ specialties }: { specialties: Specialty[] }) {
  const [q, setQ] = useState("");
  const [specialtyId, setSpecialtyId] = useState<string>("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [view, setView] = useState<ViewMode>("cards");
  const abortRef = useRef<AbortController | null>(null);

  // Restore the user's preferred view on first paint.
  useEffect(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "rows" || stored === "cards") setView(stored);
  }, []);

  const setViewPersisted = (next: ViewMode) => {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed && !specialtyId) {
      setState({ status: "idle" });
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const timer = setTimeout(async () => {
      setState({ status: "loading" });
      try {
        const params = new URLSearchParams();
        if (trimmed) params.set("q", trimmed);
        if (specialtyId) params.set("specialty_id", specialtyId);
        const res = await fetch(`/api/search?${params}`, {
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        const body = await res.json();
        if (!res.ok) {
          setState({
            status: "error",
            message:
              body?.code === "rate_limited"
                ? "عدد كبير من عمليات البحث. حاول لاحقًا."
                : "حدث خطأ أثناء البحث. الرجاء المحاولة لاحقًا.",
          });
          return;
        }
        setState({
          status: "ready",
          results: body.results as SearchHit[],
          q: trimmed,
        });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setState({
          status: "error",
          message: "حدث خطأ في الاتصال بالخادم.",
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, specialtyId]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="اكتب اسم الطبيب أو التخصص..."
          className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-4 py-3 text-base outline-none focus:border-foreground"
          aria-label="بحث"
          autoFocus
        />
        <select
          value={specialtyId}
          onChange={(e) => setSpecialtyId(e.target.value)}
          className="rounded-md border border-foreground/20 bg-transparent px-3 py-3 text-base"
          aria-label="فلترة حسب التخصص"
        >
          <option value="">كل التخصصات</option>
          {specialties.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name_ar}
            </option>
          ))}
        </select>
      </div>

      <ResultsRegion
        state={state}
        view={view}
        setView={setViewPersisted}
      />
    </div>
  );
}

function ResultsRegion({
  state,
  view,
  setView,
}: {
  state: SearchState;
  view: ViewMode;
  setView: (v: ViewMode) => void;
}) {
  if (state.status === "idle") {
    return (
      <p className="rounded border border-dashed border-foreground/20 p-8 text-center text-foreground/60">
        ابدأ بكتابة اسم أو تخصص لعرض النتائج.
      </p>
    );
  }

  if (state.status === "loading") {
    return (
      <p className="text-center text-foreground/65">جارٍ البحث...</p>
    );
  }

  if (state.status === "error") {
    return (
      <p className="rounded border border-red-300 bg-red-50 p-4 text-center text-red-800">
        {state.message}
      </p>
    );
  }

  if (state.results.length === 0) {
    return (
      <p className="rounded border border-foreground/15 bg-foreground/5 p-8 text-center text-foreground/70">
        لا توجد نتائج مطابقة.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-foreground/65">
        <span>
          {state.results.length} نتيجة
        </span>
        <div
          role="radiogroup"
          aria-label="طريقة العرض"
          className="inline-flex overflow-hidden rounded-md border border-foreground/20"
        >
          <button
            type="button"
            role="radio"
            aria-checked={view === "cards"}
            onClick={() => setView("cards")}
            className={
              "px-3 py-1.5 " +
              (view === "cards"
                ? "bg-foreground text-background"
                : "hover:bg-foreground/5")
            }
          >
            بطاقات
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view === "rows"}
            onClick={() => setView("rows")}
            className={
              "px-3 py-1.5 border-r border-foreground/20 " +
              (view === "rows"
                ? "bg-foreground text-background"
                : "hover:bg-foreground/5")
            }
          >
            قائمة
          </button>
        </div>
      </div>

      {view === "cards" ? (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {state.results.map((d) => (
            <li key={d.id}>
              <DoctorCard doctor={d} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-foreground/15 bg-background">
          {state.results.map((d) => (
            <li key={d.id}>
              <DoctorRow doctor={d} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
