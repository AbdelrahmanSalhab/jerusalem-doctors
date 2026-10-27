// What search engines and AI agents get (#171, #172, #173): the three public
// pages indexable, everything else not, the files they look for answered
// with the file or "not found", never the login page.

import { expect, test } from "@playwright/test";

const robotsMeta = (html: string) => html.match(/<meta name="robots" content="([^"]+)"/)?.[1];

test("the public pages are indexable, with a canonical address and a link preview", async ({ request }) => {
  for (const path of ["/", "/signup", "/privacy"]) {
    const html = await (await request.get(path)).text();
    expect(robotsMeta(html), path).toBe("index, follow");
    expect(html, path).toMatch(new RegExp(`<link rel="canonical" href="https://[^"]+${path === "/" ? "" : path}"`));
    expect(html, path).toContain('property="og:image"');
  }
});

test("the sign-in pages are not indexable", async ({ request }) => {
  for (const path of ["/login", "/verify"]) {
    expect(robotsMeta(await (await request.get(path)).text()), path).toBe("noindex, nofollow");
  }
});

test("robots.txt, the sitemap and llms.txt describe the public pages only", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /");
  expect(robots).toContain("Allow: /signup");
  expect(robots).toMatch(/Sitemap: https:\/\/\S+\/sitemap\.xml/);

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap.match(/<loc>/g)).toHaveLength(3);
  expect(sitemap).not.toContain("/dashboard");

  const llms = await request.get("/llms.txt");
  expect(llms.headers()["content-type"]).toContain("text/plain");
  const text = await llms.text();
  expect(text.startsWith("# ")).toBe(true);
  expect(text).toContain("](https://");
  expect(text).toContain("no public data");
});

test("a file that doesn't exist is 'not found', not the login page", async ({ request }) => {
  for (const path of ["/.well-known/ai-catalog.json", "/nonexistent.php", "/missing.txt"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
  }
  // A page path still asks a visitor to sign in.
  const page = await request.get("/dashboard", { maxRedirects: 0 });
  expect(page.status()).toBe(307);
});
