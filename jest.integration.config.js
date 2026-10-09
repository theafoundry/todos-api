const base = require("./jest.config");

module.exports = {
  ...base,
  testMatch: [
    "**/src/ai.api.integration.test.ts",
    "**/src/auth.api.test.ts",
    "**/src/authBoundary.integration.test.ts",
    "**/src/authService.test.ts",
    "**/src/prismaTodoService.test.ts",
    "**/src/adaptation.api.integration.test.ts",
    "**/src/capture.api.integration.test.ts",
    "**/src/coreProductJourneys.integration.test.ts",
    "**/src/events-insights.api.integration.test.ts",
    "**/src/feedback.api.integration.test.ts",
    "**/src/preferences.api.integration.test.ts",
  ],
};
