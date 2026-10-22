// Every Sentry.init (server, edge, browser) closes data collection and
// scrubs what it sends. Sentry 11 collects everything when dataCollection is
// left out, and ignores beforeSendTransaction, so a setup that drifts from
// this would start sending personal data.

import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ init }));

beforeEach(() => {
  vi.resetModules();
  init.mockClear();
  vi.stubEnv("SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
});

describe.each([["server", "./sentry.server.config"], ["edge", "./sentry.edge.config"], ["browser", "./instrumentation-client"]])(
  "Sentry.init on the %s",
  (_where, file) => {
    it("closes data collection and scrubs events, breadcrumbs and spans", async () => {
      await import(file);
      // The same module instance the setup file just loaded.
      const scrub = await import("@/lib/sentryScrub");
      expect(init).toHaveBeenCalledOnce();
      const opts = init.mock.calls[0][0];
      expect(opts.dataCollection).toBe(scrub.PRIVATE_DATA_COLLECTION);
      expect(opts.beforeSend).toBe(scrub.scrubEvent);
      // The browser keeps no click or console breadcrumbs at all.
      expect(opts.beforeBreadcrumb).toBe(file === "./instrumentation-client" ? scrub.browserBreadcrumb : scrub.scrubBreadcrumb);
      expect(opts.tracesSampleRate).toBe(0);
      expect(opts.beforeSendSpan).toBe(scrub.scrubSpan);
      expect(opts.traceLifecycle).toBe("stream");
      expect(opts).not.toHaveProperty("sendDefaultPii");
    });
  },
);
