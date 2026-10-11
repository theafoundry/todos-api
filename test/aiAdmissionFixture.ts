export function assertAiAdmissionFixtureUrl(
  rawUrl: string,
  marker: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): URL {
  const parsed = new URL(rawUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !/^\/planwren_ai_admission_test_[A-Za-z0-9_]+$/.test(parsed.pathname) ||
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !parsed.port ||
    !marker ||
    !/^[a-f0-9-]{36}$/.test(marker) ||
    [
      "PGHOST",
      "PGHOSTADDR",
      "PGPORT",
      "PGDATABASE",
      "PGUSER",
      "PGPASSWORD",
      "PGSERVICE",
      "PGSERVICEFILE",
      "PGPASSFILE",
      "PGOPTIONS",
    ].some((key) => !!environment[key])
  ) {
    throw new Error(
      "Admission integration tests require an explicit disposable local database",
    );
  }
  return parsed;
}
