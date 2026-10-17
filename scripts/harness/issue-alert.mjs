#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const repo = process.env.GITHUB_REPOSITORY;
const workflow = process.env.GITHUB_WORKFLOW ?? 'harness';
const runId = process.env.GITHUB_RUN_ID;
const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? 'unknown';
const ref = process.env.GITHUB_REF ?? 'unknown';
const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;
const titlePrefix = `Harness regression: ${workflow} failed`;
const title = `${titlePrefix} (${sha})`;
const body = `## Harness regression\n- workflow: ${workflow}\n- run: ${runUrl}\n- branch: ${ref}\n- commit: ${sha}\n\nView logs: ${runUrl}`;
const ALERT_LABEL = 'harness-alert';
const ALERT_LABELS = [ALERT_LABEL, 'type:ci-alert'];

// Arguments go straight to gh (no shell), so the title needs no quoting.
function gh(args, input) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], input }).trim();
  } catch (error) {
    throw new Error(`\`gh ${args.slice(0, 2).join(' ')}\` failed (exit ${error.status ?? error.code})`, { cause: error });
  }
}

const ghJson = (args) => JSON.parse(gh(args) || '[]');

// Match open alerts by title as well as label: when the alert labels are
// missing from the repository, label filtering alone would never find one.
function findOpenAlert() {
  const issues = ghJson(['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title,labels']);
  return issues.find(
    (issue) => issue.title.startsWith(titlePrefix) || issue.labels.some((label) => label.name === ALERT_LABEL),
  );
}

// gh aborts `issue create` if any --label is absent from the repository, so
// only attach labels that exist. Labels are never created here.
function availableAlertLabels() {
  const existing = new Set(ghJson(['label', 'list', '--limit', '1000', '--json', 'name']).map((label) => label.name));
  const missing = ALERT_LABELS.filter((label) => !existing.has(label));
  if (missing.length > 0) {
    console.error(
      `::warning::Harness alert labels missing from the repository: ${missing.join(', ')}. Creating the alert without them; add the labels to restore label filtering.`,
    );
  }
  return ALERT_LABELS.filter((label) => existing.has(label));
}

// gh only reads the body from stdin with `--body-file -`; without a body flag it
// refuses to run non-interactively, so the alert would never be posted.
try {
  const openAlert = findOpenAlert();
  if (openAlert) {
    gh(['issue', 'comment', String(openAlert.number), '--body-file', '-'], body);
  } else {
    const labelArgs = availableAlertLabels().flatMap((label) => ['--label', label]);
    gh(['issue', 'create', '--title', title, ...labelArgs, '--body-file', '-'], body);
  }
} catch (error) {
  console.error(`::error::Harness regression alert was not posted: ${error.message}`);
  process.exit(1);
}
