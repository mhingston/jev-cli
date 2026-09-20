import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchJevClient, defaultModelForProvider, resolveJevProvider } from "../src/client.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider resolution", () => {
  it("defaults to TypeSafe", () => {
    vi.stubEnv("JEV_PROVIDER", "");
    expect(resolveJevProvider()).toBe("typesafe");
  });

  it("honours JEV_PROVIDER", () => {
    vi.stubEnv("JEV_PROVIDER", "vercel");
    expect(resolveJevProvider()).toBe("vercel");
  });

  it("honours JEV_MODEL", () => {
    vi.stubEnv("JEV_MODEL", "jev-test");
    expect(defaultModelForProvider("typesafe")).toBe("jev-test");
  });
});

describe("FetchJevClient", () => {
  it("sends a System One compatible request", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "jev-test",
        state: { ticket: "hello" },
        questions: { urgent: { type: "fixture" } },
      });
      return new Response(JSON.stringify({
        model: "jev-test",
        answers: { urgent: { noul: 0.8 } },
        usage: { input_tokens: 10, output_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const client = new FetchJevClient({
      endpoint: "https://example.test/v1/systemone",
      model: "jev-test",
      apiKey: "test-key",
      fetchImpl,
    });

    const response = await client.systemOne({
      state: { ticket: "hello" },
      questions: { urgent: { type: "fixture" } },
    });

    expect(response.answers).toEqual({ urgent: { noul: 0.8 } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
