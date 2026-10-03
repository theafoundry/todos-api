# Planwren accessibility review

Status: public/local Fold visual evidence exists; complete public-page and actual
ChatGPT component accessibility acceptance remains pending.

## Evidence boundary

The deployed Fold release includes an accessible shared BrandMark (decorative
by default, explicitly named when needed), light/dark assets, tiny-icon checks,
local placement assertions and public release browser checks. Recorded exact
source, counts and workflow links are in
[acceptance-report.md](acceptance-report.md). These checks do not establish
screen-reader or actual ChatGPT iframe accessibility.

The release exercised standalone dark CSS in disposable browser DOM using the
existing theme class; it did not prove automatic standalone theme switching.
Do not claim full accessibility compliance from a passing icon/placement test.

## Actual ChatGPT component checks — pending

- [ ] All task/setup/fullscreen actions work by keyboard alone.
- [ ] Focus follows visual/task order and remains visible after complete, undo,
      refresh, fullscreen transitions and error recovery.
- [ ] Buttons, dates, groups and status updates have useful accessible names and
      live announcements in a supported screen reader.
- [ ] Reduced-motion preference disables non-essential animation.
- [ ] Text and controls have adequate contrast in actual light/dark containers.
- [ ] Narrow/mobile and 200% zoom layouts keep controls usable without clipping.
- [ ] Loading, empty, authenticated, expired-auth and error states are understandable
      without color alone.
- [ ] The inline/panel and fullscreen views are checked in the actual ChatGPT
      container using the dedicated synthetic account.

The focused `npm run review:accessibility` suite covers the local Today Plan
harness. Attach its exact-source output separately; a local harness pass does
not satisfy actual-container rows.

## Public-page checks — pending full manual review

Fresh public GET checks verify Privacy, Terms and Support are available with
Planwren/Thea Foundry identity. Availability is distinct from these checks:

- [ ] One meaningful `h1`, logical headings, skip link and visible keyboard focus.
- [ ] Readable line lengths, responsive layout and expected light/dark behavior.
- [ ] Descriptive link text and email purpose.
- [ ] Keyboard navigation, supported assistive technology and 200% zoom on the
      observed production source.

Record browser/assistive-tech versions, host, UTC time, exact SHA, operator,
sanitized screenshots and results in the acceptance record and
[test-cases.md](test-cases.md). Do not replace failures with a synthetic preview
or mark a check passed before it is exercised.
