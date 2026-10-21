// Israel MoH practitioners registry, CKAN client (plan §13).
//
// One endpoint: GET {base}/action/datastore_search, with a list of licences
// in `filters`, or paged through the whole registry. CKAN returns
// { success, result }.
//
// The registry is the source we cannot do without, so it is asked as little
// as possible: our own doctors' licences nightly, the whole registry weekly
// (paced), and a licence nobody has seen yet when someone signs up with it
// (app/api/cron/sync-moh, lib/moh/match.ts).

const DEFAULT_BASE = "https://data.gov.il/api/3";
const DEFAULT_RESOURCE_ID = "9c64c522-bbc2-48fe-96fb-3b2a8626f59e";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
/** Licences per request: keeps the URL near 3 KB. */
const BATCH = 300;
/** Says who is asking, so a problem reaches us rather than a silent block. */
const USER_AGENT = "jerusalem-doctors/1.0 (+https://jerusalem-doctors.vercel.app)";

export interface MohRecord {
  _id: number;
  "שם פרטי": string;
  "שם משפחה": string;
  "מספר רישיון רופא": number;
  "תאריך רישום רישיון"?: number | null;
  "מספר תעודת התמחות"?: number | null;
  "תאריך רישום התמחות"?: number | null;
  "שם התמחות"?: string | null;
}

export interface MohClientOptions {
  base?: string;
  resourceId?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export class MohClient {
  private readonly base: string;
  private readonly resourceId: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetch: typeof fetch;

  constructor(options: MohClientOptions = {}) {
    this.base = (options.base ?? process.env.MOH_API_BASE ?? DEFAULT_BASE).replace(
      /\/$/,
      "",
    );
    this.resourceId =
      options.resourceId ?? process.env.MOH_RESOURCE_ID ?? DEFAULT_RESOURCE_ID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.fetch = options.fetchImpl ?? fetch;
  }

  /**
   * Every registry row for these licences: a licence with several specialty
   * certificates has one row per certificate, and an unknown licence has
   * none. CKAN takes a list in `filters`, so this is one request per
   * BATCH licences rather than one per licence, or a sweep of all 65k rows.
   *
   * (`datastore_search_sql` would be the obvious tool, but data.gov.il
   * rejects queries naming its Hebrew columns with a 403.)
   */
  async findByLicenses(licenses: readonly number[]): Promise<MohRecord[]> {
    const wanted = [...new Set(licenses)].filter((n) => Number.isInteger(n) && n > 0);
    const out: MohRecord[] = [];
    for (let i = 0; i < wanted.length; i += BATCH) {
      const batch = wanted.slice(i, i + BATCH);
      const params = new URLSearchParams({
        resource_id: this.resourceId,
        // The most certificates any licence holds is 5 (October 2026).
        limit: String(batch.length * 10),
        filters: JSON.stringify({ "מספר רישיון רופא": batch }),
      });
      const json = await this.requestJSON<{
        success: boolean;
        result: { records: MohRecord[] };
      }>(`${this.base}/action/datastore_search?${params}`);
      if (!json.success) throw new Error("CKAN response success=false");
      out.push(...json.result.records);
    }
    return out;
  }

  /**
   * The whole registry, a page at a time with a pause between pages: about
   * 65 requests, made once a week.
   */
  async findAll(pageSize = 1000, pauseMs = 1000): Promise<MohRecord[]> {
    const out: MohRecord[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const params = new URLSearchParams({ resource_id: this.resourceId, limit: String(pageSize), offset: String(offset) });
      const json = await this.requestJSON<{
        success: boolean;
        result: { records: MohRecord[] };
      }>(`${this.base}/action/datastore_search?${params}`);
      if (!json.success) throw new Error("CKAN response success=false");
      out.push(...json.result.records);
      if (json.result.records.length < pageSize) return out;
      await sleep(pauseMs);
    }
  }

  private async requestJSON<T>(url: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetch(url, {
          method: "GET",
          signal: ctrl.signal,
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        });
        // Refused or asked to slow down: asking again straight away is how a
        // client gets blocked, so give up until the next run.
        if (res.status === 403 || res.status === 429) throw new MohRefusedError(res.status);
        if (!res.ok) {
          throw new Error(`MoH HTTP ${res.status}`);
        }
        return (await res.json()) as T;
      } catch (e) {
        if (e instanceof MohRefusedError) throw e;
        lastErr = e;
        if (attempt < this.retries) {
          await sleep(200 * Math.pow(2, attempt));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("MoH request failed after retries");
  }
}

export class MohRefusedError extends Error {
  constructor(readonly status: number) {
    super(`MoH HTTP ${status}`);
    this.name = "MohRefusedError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
