"use client";

import { countOf, DOCTORS } from "@/lib/arabicCount";
import { useEffect, useRef, useState } from "react";
import { DoctorCard } from "@/components/DoctorCard";
import { DoctorRow } from "@/components/DoctorRow";
import { SpecialtyFilter } from "@/components/SpecialtyFilter";
import { type FilterInstitution, SearchFilterPanel } from "@/components/SearchFilterPanel";
import { activeFilterCount, NO_FILTERS, setFilterParams, type SearchFilters } from "@/lib/searchFilters";
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
/** Chips shown before "كل التخصصات": more than this and the list fills a
 *  phone screen, pushing the results and the featured doctors out of
 *  sight. */
const CHIPS_COLLAPSED = 5;
/** Cards flow down columns instead of across grid rows. Their heights vary a
 *  lot (a long bio and two workplaces next to a name and a phone number), and
 *  a grid row is as tall as its tallest card, so a short card used to leave a
 *  hole beside it. In multicol `gap` is the column gap only, so the vertical
 *  rhythm between cards is the item's own margin. */
const CARD_COLUMNS = "columns-1 gap-4 md:columns-2";
const CARD_COLUMN_ITEM =
  "mb-4 break-inside-avoid [-webkit-column-break-inside:avoid]";

export function DashboardSearch({
  specialties,
  featured,
  listed,
  domainCounts,
  recent,
  institutions,
}: {
  specialties: Specialty[];
  /** «جديد هذا الأسبوع», already ranked for this viewer. */
  recent: SearchHit[];
  /** Hospitals and funds with listed doctors, for the filter panel. */
  institutions: FilterInstitution[];
  featured: FeaturedDoctors;
  /** Doctors in the directory, for the line under the search box. */
  listed: number | null;
  /** Listed doctors per top-level specialty, for ordering the chips and
   *  dropping the empty ones. */
  domainCounts: Record<string, number>;
}) {
  const [q, setQ] = useState("");
  const [specialtyId, setSpecialtyId] = useState<string>("");
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS);
  const filtering = activeFilterCount(filters) > 0;
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [view, setView] = useState<ViewMode>("cards");
  const [allChips, setAllChips] = useState(false);
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
    // Nothing typed or chosen renders as idle (see `shown` below), no fetch.
    if (!trimmed && !specialtyId && !filtering) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const timer = setTimeout(async () => {
      setState({ status: "loading" });
      try {
        const params = new URLSearchParams();
        if (trimmed) params.set("q", trimmed);
        if (specialtyId) params.set("specialty_id", specialtyId);
        setFilterParams(params, filters);
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
  }, [q, specialtyId, filters, filtering]);

  // Busiest specialties first, and never a chip that leads to an empty
  // result. With no counts (a failed read) the chips stay as they were:
  // every specialty, in the admin's sort order.
  const hasCounts = Object.keys(domainCounts).length > 0;
  const domains = specialties
    .filter((s) => s.parent_id === null && (!hasCounts || (domainCounts[s.id] ?? 0) > 0))
    .sort((a, b) => (domainCounts[b.id] ?? 0) - (domainCounts[a.id] ?? 0));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2 sm:gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث عن طبيب أو تخصص"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-4 py-3 text-base"
          aria-label="بحث"
        />
        <div className="min-w-0 max-w-[50%] shrink-0 sm:w-56 sm:max-w-none">
          <SpecialtyFilter
            options={specialties}
            value={specialtyId}
            onChange={setSpecialtyId}
          />
        </div>
      </div>

      <SearchFilterPanel institutions={institutions} value={filters} onChange={setFilters} />

      {!q.trim() && !specialtyId && !filtering && (
        <div className="flex flex-col gap-2">
          {listed !== null && (
            <p className="text-sm text-muted">
              <span className="font-semibold text-foreground">{countOf(listed, DOCTORS)}</span> في الدليل.
            </p>
          )}
          <ul className="flex flex-wrap gap-2">
            {(allChips ? domains : domains.slice(0, CHIPS_COLLAPSED)).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSpecialtyId(s.id)}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-foreground/40"
                >
                  {s.name_ar}
                  {domainCounts[s.id] ? (
                    <span className="text-xs text-muted">{domainCounts[s.id]}</span>
                  ) : null}
                </button>
              </li>
            ))}
            {domains.length > CHIPS_COLLAPSED && (
              <li>
                <button
                  type="button"
                  onClick={() => setAllChips((v) => !v)}
                  className="rounded-full border border-dashed border-line bg-surface px-3 py-1.5 text-sm text-muted hover:border-foreground/40 hover:text-foreground"
                  aria-expanded={allChips}
                  aria-label={allChips ? "عرض تخصصات أقل" : "عرض كل التخصصات"}
                >
                  {allChips ? "أقل" : `+${domains.length - CHIPS_COLLAPSED}`}
                </button>
              </li>
            )}
          </ul>
        </div>
      )}

      <ResultsRegion
        state={!q.trim() && !specialtyId && !filtering ? { status: "idle" } : state}
        featured={featured}
        recent={recent}
        view={view}
        setView={setViewPersisted}
      />
    </div>
  );
}

function ResultsRegion({
  state,
  featured,
  recent,
  view,
  setView,
}: {
  state: SearchState;
  featured: FeaturedDoctors;
  recent: SearchHit[];
  view: ViewMode;
  setView: (v: ViewMode) => void;
}) {
  if (state.status === "idle") {
    const hasFeatured = featured.doctor || featured.graduates.length > 0 || recent.length > 0;
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
        {recent.length > 0 && (
          <FeaturedSection title="جديد هذا الأسبوع">
            <ul className="overflow-hidden rounded-lg border border-foreground/15 bg-background">
              {recent.map((d) => (
                <li key={d.id}>
                  <DoctorRow doctor={d} />
                </li>
              ))}
            </ul>
          </FeaturedSection>
        )}
        {featured.graduates.length > 0 && (
          <FeaturedSection title="أطباء مميزون يبحثون عن عمل">
            <ul className={CARD_COLUMNS}>
              {featured.graduates.map((d) => (
                <li key={d.id} className={CARD_COLUMN_ITEM}>
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
        <ul className={CARD_COLUMNS}>
          {state.results.map((d) => (
            <li key={d.id} className={CARD_COLUMN_ITEM}>
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
