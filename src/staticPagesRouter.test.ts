import express from "express";
import path from "path";
import { HtmlValidate } from "html-validate";
import fs from "fs";
import request from "supertest";
import { createStaticPagesRouter } from "./routes/staticPagesRouter";

function appWithToken(token?: string | null) {
  const app = express();
  app.use(createStaticPagesRouter({ domainVerificationToken: token }));
  return app;
}

describe("hosted review pages", () => {
  it("serves the versioned reviewer demo as a public MP4", async () => {
    const response = await request(appWithToken())
      .get("/review/todos-chatgpt-demo-v1.mp4")
      .expect(200);

    expect(response.headers["content-type"]).toBe("video/mp4");
    expect(response.headers["cache-control"]).toBe("public, max-age=3600");
    expect(response.body.length).toBeGreaterThan(100_000);
    expect(
      fs.statSync(
        path.join(__dirname, "../docs/review/assets/todos-chatgpt-demo-v1.mp4"),
      ).size,
    ).toBe(response.body.length);
  });

  it("serves the configured domain challenge as the exact plain-text body", async () => {
    const token = "portal-domain-challenge-value";
    const response = await request(appWithToken(token))
      .get("/.well-known/openai-apps-challenge")
      .expect(200);

    expect(response.text).toBe(token);
    expect(response.headers["content-type"]).toMatch(/^text\/plain/);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each([undefined, null, "", "  ", " padded", "unsafe\nsecond-line"])(
    "does not expose a challenge when configuration is absent or malformed",
    async (token) => {
      const response = await request(appWithToken(token))
        .get("/.well-known/openai-apps-challenge")
        .expect(404);
      expect(response.text).toBe("");
    },
  );

  it("does not accept unsupported challenge methods", async () => {
    await request(appWithToken("configured"))
      .post("/.well-known/openai-apps-challenge")
      .expect(404);
  });

  it.each([
    ["/privacy", "Privacy policy"],
    ["/terms", "Terms of use"],
    ["/support", "Support"],
  ])("serves %s as an accessible standalone page", async (path, title) => {
    const response = await request(appWithToken()).get(path).expect(200);
    expect(response.headers["content-type"]).toMatch(/^text\/html/);
    expect(response.text).toContain(`<h1>${title}</h1>`);
    expect(response.text).toContain('href="#main-content"');
    expect(response.text).toContain("hello@theafoundry.com");
    expect(response.text).not.toContain("TBD");
    const report = await new HtmlValidate({
      extends: ["html-validate:recommended"],
    }).validateString(response.text);
    expect(report.results.flatMap((result) => result.messages)).toEqual([]);
  });
});
