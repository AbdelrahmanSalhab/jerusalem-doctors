// Next.js calls this once on server startup. Used to register Sentry server
// + edge runtimes. The client-side init is in `instrumentation-client.ts`.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (err: unknown, request: unknown, context: unknown) => {
  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
    const { captureRequestError } = await import("@sentry/nextjs");
    captureRequestError(err, request as Parameters<typeof captureRequestError>[1], context as Parameters<typeof captureRequestError>[2]);
  }
};
