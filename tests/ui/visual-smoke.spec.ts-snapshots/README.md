# Visual smoke baselines

These are real, reviewed Chromium renders of the landing page, login form,
loaded Focus dashboard and focused command palette. The desktop viewport is
1440 × 900 at device scale 1, in light mode, with reduced motion. Tests fix the
browser clock to 2026-01-15 15:00 UTC and wait for fonts, dashboard data and
landing images before capture.

Separate `darwin` and `linux` baselines preserve the product's native system-font
stack. Its different line wrapping makes the full landing page 3435 pixels tall
on macOS and 3379 pixels on Linux. Both platforms retain the same 5% comparison
limit; no regions are masked or cropped. Windows baselines are not provided.

Capture environment: Node 22.22.1, Playwright 1.59.1 and its matching Chromium.
Linux images were inspected from `mcr.microsoft.com/playwright:v1.59.1-noble`
(Ubuntu 24.04, arm64); macOS images were captured natively on arm64. Every PNG
was visually inspected before being added here. The two landing illustrations
in `client-react/public/images/landing` are real light/dark app screenshots
captured with mocked local data; they contain no user account data.

Build all three client surfaces before running the suite, as the visual workflow
does:

```sh
npm --prefix client-react run build:all
CI=1 npm run test:ui
```

For intentional UI changes, render candidate screenshots separately, inspect
the complete pages and image-loading/readiness assertions, then replace only
the reviewed platform images. Do not accept a blank page, broken image or loading
state as a new baseline.
