"use client";

import { countOf, DOCTORS } from "@/lib/arabicCount";
import { useEffect, useRef, useState } from "react";
import { DoctorCard } from "@/components/DoctorCard";
import { DoctorRow } from "@/components/DoctorRow";
import { SpecialtyFilter } from "@/components/SpecialtyFilter";
import { SEARCH_PAGE_SIZE, type FeaturedDoctors, type SearchHit } from "@/lib/directory";

type Specialty = { id: string; name_ar: string; parent_id: string | null };
type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; results: SearchHit[]; q: string; truncated: boolean }
  | { status: "error"; message: string };

type ViewMode = "cards" | "rows";

const DEBOUNCE_MS = 250;
const VIEW_STORAGE_KEY = "search:view";

export function DashboardSearch({
  specialties,
  featured,
  listed,
}: {
  specialties: Specialty[];
  featured: FeaturedDoctors;
  /** Doctors in the directory, for the line under the search box. */
  listed: number | null;
}) {
  const [q, setQ] = useState("");
  const [specialtyId, setSpecialtyId] = useState<string>("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [view, setView] = useState<ViewMode>("cards");
  const abortRef = useRef<AbortController | null>(null);

  // Restore the user's preferred view on first paint.
  useEffect(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    // Read after mount on purpose: the server render has no localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "rows" || stored === "cards") setView(stored);
  }, []);

  const setViewPersisted = (next: ViewMode) => {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  useEffect(() => {
    const trimmed = q.trim();
    // An empty query renders as idle (see `shown` below), no fetch needed.
    if (!trimmed && !specialtyId) return;

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
          truncated: body.truncated === true,
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
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-4 py-3 text-base"
          aria-label="بحث"
        />
        <div className="sm:w-56">
          <SpecialtyFilter
            options={specialties}
            value={specialtyId}
            onChange={setSpecialtyId}
          />
        </div>
      </div>

      {!q.trim() && !specialtyId && (
        <div className="flex flex-col gap-2">
          {listed !== null && (
            <p className="text-sm text-muted">
              <span className="font-semibold text-foreground">{countOf(listed, DOCTORS)}</span> في الدليل. تصفّح حسب التخصص:
            </p>
          )}
          <ul className="flex flex-wrap gap-2">
            {specialties
              .filter((s) => s.parent_id === null)
              .map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSpecialtyId(s.id)}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-foreground/40"
                  >
                    {s.name_ar}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      <ResultsRegion
        state={!q.trim() && !specialtyId ? { status: "idle" } : state}
        featured={featured}
        view={view}
        setView={setViewPersisted}
      />
    </div>
  );
}

function ResultsRegion({
  state,
  featured,
  view,
  setView,
}: {
  state: SearchState;
  featured: FeaturedDoctors;
  view: ViewMode;
  setView: (v: ViewMode) => void;
}) {
  if (state.status === "idle") {
    const hasFeatured = featured.doctor || featured.graduates.length > 0;
    return (
      <div className="space-y-8">
        {!hasFeatured && (
          <p className="rounded border border-dashed border-foreground/20 p-8 text-center text-foreground/60">
            ابدأ بكتابة اسم أو تخصص لعرض النتائج.
          </p>
        )}
        {featured.doctor && (
          <FeaturedSection title="طبيب نفتخر به">
            <DoctorCard doctor={featured.doctor} />
          </FeaturedSection>
        )}
        {featured.graduates.length > 0 && (
          <FeaturedSection title="أطباء مميزون يبحثون عن عمل">
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {featured.graduates.map((d) => (
                <li key={d.id}>
                  <DoctorCard doctor={d} />
                </li>
              ))}
            </ul>
          </FeaturedSection>
        )}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <p className="text-center text-foreground/65">جارٍ البحث...</p>
    );
  }

  if (state.status === "error") {
    return (
      <p role="alert" className="rounded border border-danger-line bg-danger-bg p-4 text-center text-danger">
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
                ? "bg-primary text-primary-fg"
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
                ? "bg-primary text-primary-fg"
                : "hover:bg-foreground/5")
            }
          >
            قائمة
          </button>
        </div>
      </div>
      {state.truncated && (
        <p className="text-sm text-foreground/65">
          يتم عرض أول {SEARCH_PAGE_SIZE} نتيجة فقط، حدّد البحث أكثر لرؤية الباقي.
        </p>
      )}

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

function FeaturedSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
