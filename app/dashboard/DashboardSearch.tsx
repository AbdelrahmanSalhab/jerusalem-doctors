"use client";

import { countOf, DOCTORS } from "@/lib/arabicCount";
import { useEffect, useRef, useState } from "react";
import { DoctorCard } from "@/components/DoctorCard";
import { DoctorRow } from "@/components/DoctorRow";
import { PrivacyShieldIcon } from "@/components/PrivacyShieldIcon";
import { type FilterInstitution, SearchFilterChips } from "@/components/SearchFilterChips";
import { activeFilterCount, searchParamsOf, type DashboardSearchState } from "@/lib/searchFilters";
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

const URL_KEYS = ["q", "specialty_id", "institution_id", "workplace_type", "stage", "seeking_work"];

export function DashboardSearch({
  specialties,
  initial,
  featured,
  listed,
  domainCounts,
  recent,
  institutions,
}: {
  specialties: Specialty[];
  /** The search the URL carried when the page loaded. */
  initial: DashboardSearchState;
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
  const [q, setQ] = useState(initial.q);
  const [specialtyId, setSpecialtyId] = useState(initial.specialtyId);
  const [filters, setFilters] = useState(initial.filters);
  const filtering = activeFilterCount(filters) > 0;
  // A search carried by the URL shows "searching" at once, not the idle page.
  const [state, setState] = useState<SearchState>(
    initial.q || initial.specialtyId || activeFilterCount(initial.filters) > 0
      ? { status: "loading" }
      : { status: "idle" },
  );
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

  // Keep the search in the address bar (#177). replaceState, not a push: the
  // back button should leave the dashboard, not step through keystrokes. Other
  // parameters (?existing=1) are left alone.
  useEffect(() => {
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      URL_KEYS.forEach((k) => url.searchParams.delete(k));
      searchParamsOf({ q, specialtyId, filters }).forEach((v, k) => url.searchParams.set(k, v));
      const next = url.pathname + url.search + url.hash;
      if (next !== window.location.pathname + window.location.search + window.location.hash) {
        window.history.replaceState(null, "", next);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, specialtyId, filters]);

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
        const params = searchParamsOf({ q, specialtyId, filters });
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
      <div className="flex flex-col gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث عن طبيب أو تخصص"
          className="w-full rounded-md border border-line bg-surface px-4 py-3 text-base"
          aria-label="بحث"
        />
        <SearchFilterChips
          specialties={specialties}
          specialtyId={specialtyId}
          onSpecialty={setSpecialtyId}
          institutions={institutions}
          filters={filters}
          onFilters={setFilters}
        />
      </div>

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
                  className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-foreground/40 pointer-coarse:min-h-11"
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
                  className="rounded-full border border-dashed border-line bg-surface px-3 py-1.5 text-sm text-muted pointer-coarse:min-h-11 hover:border-foreground/40 hover:text-foreground"
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

      {/* Many doctors' work number is their personal one (#192). Always
          shown, above whatever lists numbers, so nothing moves when results
          arrive. */}
      <p className="flex items-start gap-2.5 rounded-lg border border-warn-line border-s-4 border-s-warn-solid bg-warn-bg p-3 text-sm leading-relaxed text-warn">
        <PrivacyShieldIcon className="text-warn-solid" />
        <span>
          <strong className="font-semibold">للأطباء فقط:</strong> أرقام الزملاء مخصّصة للتواصل
          المهني بين الأطباء. نرجو عدم مشاركتها مع المرضى أو مع أي شخص من خارج الطاقم
          الطبي، احترامًا لخصوصيتهم.
        </span>
      </p>

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
        {/* After the featured doctors: the admins' picks lead. */}
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
      <div className="rounded border border-foreground/15 bg-foreground/5 p-8 text-center text-foreground/70">
        <p>لا توجد نتائج مطابقة.</p>
        {/* Only for a typed name: a filter-only search names nobody to ask for. */}
        {state.q && <NumberRequest key={state.q} q={state.q} />}
      </div>
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
              "px-3 py-1.5 pointer-coarse:min-h-11 " +
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
              "px-3 py-1.5 pointer-coarse:min-h-11 border-r border-foreground/20 " +
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

/** A search that found nobody: ask the admins for that doctor's number
 *  (app/api/number-requests). They answer over WhatsApp. */
function NumberRequest({ q }: { q: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error" | "rate_limited">("idle");

  const send = async () => {
    setStatus("sending");
    try {
      const res = await fetch("/api/number-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      setStatus(res.ok ? "sent" : res.status === 429 ? "rate_limited" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <p role="status" className="mt-4 text-sm font-medium text-foreground">
        وصل طلبك للإدارة، وسنرسل لك الرقم عبر واتساب.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-2 text-sm">
      <p>لم تجد الطبيب الذي تبحث عنه؟</p>
      <button
        type="button"
        onClick={send}
        disabled={status === "sending"}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-fg disabled:opacity-50"
      >
        اطلب رقمه من الإدارة
      </button>
      {(status === "error" || status === "rate_limited") && (
        <p role="alert" className="text-danger">
          {status === "rate_limited"
            ? "أرسلت طلبات كثيرة اليوم. حاول غدًا."
            : "تعذّر إرسال الطلب. الرجاء المحاولة لاحقًا."}
        </p>
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
