# Inline CSS, and where #174 and #176 ended up

## Inline CSS (#176 item 2): not adopted

`experimental.inlineCss: true` against the same build without it. Lighthouse
12.6.1, mobile (simulated Slow 4G), `/` on a local production build, 5 runs per
row, median. The order was base, inline, base again; the two base rows agree,
so the machine was steady.

| | Base | Inline CSS | Base again |
|---|---|---|---|
| First Contentful Paint | 1366 ms | 1363 ms | 1363 ms |
| Largest Contentful Paint | 2872 ms | 3026 ms | 2868 ms |
| Total Blocking Time | 176 ms | 182 ms | 127 ms |
| HTML document transferred | 10.1 KB | 33.9 KB | 10.1 KB |
| Total transferred | 483 KB | 499 KB | 483 KB |

First paint did not move, Largest Contentful Paint was slightly worse, and
every page load carries about 24 KB more HTML (the styles twice, once in
`<style>` and once in the RSC payload, as Next's docs warn). Most visits are
returning doctors, who would otherwise have the stylesheet cached. Kept as is.

Local numbers, no CDN: they say "no gain to find here", not how production
would behave.

## #174 (Sentry): done

Production `/`, Lighthouse mobile:

| | 25 Oct | 28 Oct |
|---|---|---|
| Unused JavaScript | 123 KiB | 74 KiB |
| Total Blocking Time | 140 ms | 30 to 50 ms |
| Main script file | 155 KB | 127.4 KiB |

Not done on purpose: loading Sentry after the page is interactive (a late
start would miss early errors, for a score that is already 99), and the build
plugin with source maps (no new CI secret).

## #176: done

1. Polyfills: Next's own 614 byte `polyfill-module.js`; nothing to change.
2. Render-blocking CSS: measured above, not adopted.
3. Hydration cost: Total Blocking Time is 30 to 50 ms now (was 140 ms), after
   the Sentry and Zod changes.
