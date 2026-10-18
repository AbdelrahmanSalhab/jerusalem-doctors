// A stand-in Supabase client for route tests. Each `from(table)` call takes
// the next queued result for that table (default: no row, no error), and
// every builder call is recorded so a test can assert what was written.
//
// Usage in a test file:
//   vi.mock("@/lib/supabase/service", async () => {
//     const { db } = await import("@/test/fakeSupabase");
//     return { createSupabaseServiceClient: () => db.client };
//   });

import { vi } from "vitest";

export interface FakeResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

export interface FakeCall {
  table: string;
  method: string;
  args: unknown[];
}

const METHODS = [
  "select", "insert", "update", "delete", "upsert",
  "eq", "in", "or", "order", "limit", "maybeSingle", "single",
];

function createDb() {
  const queues = new Map<string, FakeResult[]>();
  const calls: FakeCall[] = [];

  const client = {
    from(table: string) {
      let result: FakeResult | undefined;
      const resolve = () => {
        result ??= queues.get(table)?.shift() ?? {};
        return { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null };
      };
      const chain: Record<string, unknown> = {
        then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
          return Promise.resolve(resolve()).then(onOk, onErr);
        },
      };
      for (const method of METHODS) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return chain;
        };
      }
      return chain;
    },
  };

  return {
    client,
    calls,
    /** Queue results for successive `from(table)` calls, in order. */
    queue(table: string, ...results: FakeResult[]) {
      queues.set(table, [...(queues.get(table) ?? []), ...results]);
    },
    /** Arguments of every `method` call on `table`. */
    argsOf(table: string, method: string) {
      return calls.filter((c) => c.table === table && c.method === method).map((c) => c.args);
    },
    reset() {
      queues.clear();
      calls.length = 0;
    },
  };
}

export const db = createDb();

/** The Supabase Auth surface the routes touch, via createSupabaseServerClient. */
export const auth = {
  getUser: vi.fn(),
  getClaims: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
};

export function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.test${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
