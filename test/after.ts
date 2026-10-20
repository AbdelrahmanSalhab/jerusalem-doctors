// next/server's after() only works inside a real request. Route tests mock it
// with deferAfter and call runAfter() once the response is back, which is the
// order production runs them in.
//
//   vi.mock("next/server", async (importOriginal) => ({
//     ...(await importOriginal<typeof import("next/server")>()),
//     after: (await import("@/test/after")).deferAfter,
//   }));

const tasks: (() => unknown)[] = [];

export function deferAfter(task: (() => unknown) | Promise<unknown>): void {
  tasks.push(typeof task === "function" ? task : () => task);
}

export async function runAfter(): Promise<void> {
  while (tasks.length > 0) await tasks.shift()!();
}
