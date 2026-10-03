const assert = require("node:assert/strict");

// These literal deltas are the approved public-submission changes to the
// immutable historical tool definitions. Never derive expectations from the
// implementation or omit fields from the final whole-object comparison.
function applyApprovedSubmissionChanges(reviewedTools) {
  const tools = structuredClone(reviewedTools);
  for (const name of ["complete_task", "reschedule_task"]) {
    const matches = tools.filter((tool) => tool.name === name);
    assert.equal(matches.length, 1, `The historical ${name} must exist once`);
    assert.equal(
      matches[0].annotations.destructiveHint,
      false,
      `The historical ${name} destructive annotation must remain unchanged`,
    );
    matches[0].annotations.destructiveHint = true;
  }

  const renderers = tools.filter((tool) => tool.name === "render_today_plan");
  assert.ok(renderers.length <= 1, "The historical renderer must not repeat");
  if (renderers.length === 1) {
    assert.equal(
      renderers[0].description,
      "Render a compact Today Plan after plan_today by revalidating the same date, time budget, energy, and ordered task IDs against authoritative Todos state.",
      "The historical renderer description must remain unchanged",
    );
    renderers[0].description =
      "Render a compact Today Plan after plan_today by revalidating the same date, time budget, energy, and ordered task IDs against authoritative Planwren state.";
  }
  return tools;
}

module.exports = { applyApprovedSubmissionChanges };
