// public/sw.js is plain script, so it runs here against a stand-in `self`:
// what a push shows, and where a tap on it goes.

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: Record<string, unknown>) => void;
const handlers: Record<string, Handler> = {};
const showNotification = vi.fn(async () => {});
const openWindow = vi.fn(async () => {});
let windows: { url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> }[] = [];

function load() {
  const self = {
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    registration: { showNotification, navigationPreload: undefined },
    clients: { matchAll: async () => windows, openWindow, claim: async () => {} },
    location: { origin: "https://jd.example" },
    skipWaiting: () => {},
  };
  new Function("self", "caches", "Request", "URL", readFileSync("public/sw.js", "utf8"))(self, {}, class {}, URL);
}

/** Runs a handler and returns the promise it gave to waitUntil. */
async function fire(type: string, event: Record<string, unknown>) {
  let work: Promise<unknown> = Promise.resolve();
  handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (work = p) });
  await work;
}
const push = (data: unknown) => fire("push", { data: { json: () => data } });
const tap = (url: unknown) => {
  const close = vi.fn();
  return { close, done: fire("notificationclick", { notification: { close, data: { url } } }) };
};

beforeEach(() => {
  vi.clearAllMocks();
  windows = [];
  load();
});

describe("a push", () => {
  it("shows its title, in Arabic right to left, replacing the last one with the same tag", async () => {
    await push({ title: "طبيب جديد بانتظار القبول", url: "/admin?status=pending", tag: "doctor_waiting" });
    expect(showNotification).toHaveBeenCalledWith("طبيب جديد بانتظار القبول", expect.objectContaining({ tag: "doctor_waiting", lang: "ar", dir: "rtl", data: { url: "/admin?status=pending" } }));
  });

  it("still shows something when the body is empty or unreadable, because browsers insist", async () => {
    await fire("push", {});
    await fire("push", { data: { json: () => { throw new Error("not json"); } } });
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification.mock.calls[0]).toEqual(["دليل أطباء القدس", expect.objectContaining({ data: { url: "/admin" } })]);
  });

  it("only ever opens a path in this app", async () => {
    for (const url of ["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)", 5, undefined]) {
      showNotification.mockClear();
      await push({ title: "x", url });
      expect(showNotification).toHaveBeenCalledWith("x", expect.objectContaining({ data: { url: "/admin" } }));
    }
  });
});

describe("a tap on it", () => {
  it("closes it, and takes an open window of the app there", async () => {
    const win = { url: "https://jd.example/dashboard", focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) };
    windows = [{ url: "https://other.example/", focus: vi.fn(), navigate: vi.fn() }, win];
    const { close, done } = tap("/admin/reports");
    await done;
    expect(close).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.navigate).toHaveBeenCalledWith("/admin/reports");
    expect(windows[0].focus).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens the app when none is open, and never to an outside address", async () => {
    await tap("/admin/stats").done;
    expect(openWindow).toHaveBeenCalledWith("/admin/stats");
    await tap("https://evil.example").done;
    expect(openWindow).toHaveBeenLastCalledWith("/admin");
  });
});
