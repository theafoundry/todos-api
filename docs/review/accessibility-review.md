# Accessibility review

Status: pending hosted evidence

The Today Plan component already has a focused Playwright suite. Run
`npm run review:accessibility` and attach its output plus browser screenshots.

## Component checks

- [ ] All task actions work by keyboard alone.
- [ ] Focus order follows visual/task order and focus remains visible.
- [ ] Buttons, dates, status updates, and task groups have useful accessible
      names and live announcements.
- [ ] Reduced-motion preference disables non-essential animation.
- [ ] Text and controls meet contrast expectations in light and dark modes.
- [ ] Layout remains usable at narrow width and 200% zoom without horizontal
      clipping of controls.
- [ ] Loading, empty, authenticated, expired-auth, and error states are
      understandable without color alone.
- [ ] Responsive behavior is verified in the actual ChatGPT iframe, not only the
      local harness.

## Public-page checks

- [ ] Privacy, Terms, and Support have one `h1`, logical headings, a skip link,
      visible focus, readable line lengths, responsive layout, and dark mode.
- [ ] Links have descriptive text and email links identify their purpose.
- [ ] 200% zoom and keyboard navigation pass in a production browser.

Record tested browser versions, host, date, commit SHA, screenshots, and any
waived issue in `acceptance-report.md`.
