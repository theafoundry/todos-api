import path from "path";

const DEFAULT_DB_REQUIRED_TEST_PATTERNS = [
  "src/ai.api.integration.test.ts",
  "src/adaptation.api.integration.test.ts",
  "src/auth.api.test.ts",
  "src/authBoundary.integration.test.ts",
  "src/authService.test.ts",
  "src/capture.api.integration.test.ts",
  "src/coreProductJourneys.integration.test.ts",
  "src/events-insights.api.integration.test.ts",
  "src/feedback.api.integration.test.ts",
  "src/preferences.api.integration.test.ts",
  "src/prismaTodoService.test.ts",
];

function getConfiguredPatterns(): string[] {
  const raw = process.env.DB_REQUIRED_TESTS?.trim();
  if (!raw) {
    return DEFAULT_DB_REQUIRED_TEST_PATTERNS;
  }

  return raw
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

export function shouldSetupDatabaseForArgs(args: string[]): boolean {
  const patterns = getConfiguredPatterns();
  const explicitSelections = args.filter((arg) => arg.endsWith(".ts"));
  const hasExplicitTestSelection = explicitSelections.length > 0;

  if (!hasExplicitTestSelection) {
    return true;
  }

  return explicitSelections.some((arg) => isPatternMatch(arg, patterns));
}

export function isDbRequiredTestPath(testPath: string): boolean {
  const patterns = getConfiguredPatterns();
  return isPatternMatch(testPath, patterns);
}

function isPatternMatch(target: string, patterns: string[]): boolean {
  const normalizedTarget = target.replace(/\\/g, "/");
  const targetBase = path.basename(normalizedTarget);

  return patterns.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, "/");
    const patternBase = path.basename(normalizedPattern);
    return (
      normalizedTarget.includes(normalizedPattern) ||
      targetBase === patternBase ||
      normalizedTarget.endsWith(patternBase)
    );
  });
}
