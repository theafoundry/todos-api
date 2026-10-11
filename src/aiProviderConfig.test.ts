const keys = [
  "AI_PROVIDER_ENABLED",
  "AI_PROVIDER_DAILY_BUDGET_USD",
  "AI_PROVIDER_DAILY_REQUEST_LIMIT_FREE",
  "AI_PROVIDER_DAILY_REQUEST_LIMIT_PRO",
  "AI_PROVIDER_DAILY_REQUEST_LIMIT_TEAM",
  "AI_PROVIDER_INPUT_USD_PER_MILLION_TOKENS",
  "AI_PROVIDER_OUTPUT_USD_PER_MILLION_TOKENS",
  "AI_PROVIDER_INPUT_TOKEN_CEILING",
  "AI_DAILY_SUGGESTION_LIMIT",
  "AI_DAILY_SUGGESTION_LIMIT_FREE",
  "AI_DAILY_SUGGESTION_LIMIT_PRO",
  "AI_DAILY_SUGGESTION_LIMIT_TEAM",
];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const read = () => {
  let config: typeof import("./config").config;
  jest.isolateModules(() => {
    config = require("./config").config;
  });
  return config!;
};
describe("Provider configuration fails closed", () => {
  beforeEach(() => {
    for (const key of keys) delete process.env[key];
  });
  afterAll(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  test("OFF and unset monetary ceilings stay unset, approved separate quotas share tier limits", () => {
    const c = read();
    expect(c.aiProviderEnabled).toBe(false);
    expect(c.aiProviderDailyBudgetMicros).toBeUndefined();
    expect(c.aiProviderDailyRequestLimitByPlan).toEqual({
      free: 50,
      pro: 250,
      team: 1000,
    });
    expect(c.aiProviderDailyRequestLimitByPlan).not.toBe(
      c.aiDailySuggestionLimitByPlan,
    );
    expect(c.aiProviderInputPriceMicrosPerMillionTokens).toBeUndefined();
    expect(c.aiProviderInputTokenCeiling).toBeUndefined();
  });
  test("configured existing tiers also become the independent provider defaults", () => {
    process.env.AI_DAILY_SUGGESTION_LIMIT_FREE = "9";
    process.env.AI_DAILY_SUGGESTION_LIMIT_PRO = "19";
    process.env.AI_DAILY_SUGGESTION_LIMIT_TEAM = "29";
    const c = read();
    expect(c.aiProviderDailyRequestLimitByPlan).toEqual({
      free: 9,
      pro: 19,
      team: 29,
    });
    c.aiProviderDailyRequestLimitByPlan!.free = 1;
    expect(c.aiDailySuggestionLimitByPlan.free).toBe(9);
  });
  test.each(["", "0", "-1", "1e3", "1.0000001", "NaN", "9007199255", "1junk"])(
    "rejects invalid budget %p",
    (value) => {
      process.env.AI_PROVIDER_DAILY_BUDGET_USD = value;
      expect(read().aiProviderDailyBudgetMicros).toBeUndefined();
    },
  );
  test("parses USD exactly without binary floating point", () => {
    process.env.AI_PROVIDER_DAILY_BUDGET_USD = "0.000001";
    process.env.AI_PROVIDER_INPUT_USD_PER_MILLION_TOKENS = "12.345678";
    const c = read();
    expect(c.aiProviderDailyBudgetMicros).toBe(1);
    expect(c.aiProviderInputPriceMicrosPerMillionTokens).toBe(12_345_678);
  });
  test("tier limits require all three positive safe integers", () => {
    process.env.AI_PROVIDER_DAILY_REQUEST_LIMIT_FREE = "2";
    process.env.AI_PROVIDER_DAILY_REQUEST_LIMIT_PRO = "3";
    expect(read().aiProviderDailyRequestLimitByPlan).toBeUndefined();
    process.env.AI_PROVIDER_DAILY_REQUEST_LIMIT_TEAM = "4junk";
    expect(read().aiProviderDailyRequestLimitByPlan).toBeUndefined();
    process.env.AI_PROVIDER_DAILY_REQUEST_LIMIT_TEAM = "4";
    expect(read().aiProviderDailyRequestLimitByPlan).toEqual({
      free: 2,
      pro: 3,
      team: 4,
    });
  });
});
