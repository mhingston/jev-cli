import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareJevClient,
  FetchJevClient,
  createJevClient,
  credentialEnvironmentForProvider,
  defaultEndpointForProvider,
  defaultModelForProvider,
  resolveJevProvider,
} from "../src/client.js";

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

  it("supports the openrouter provider", () => {
    vi.stubEnv("JEV_PROVIDER", "openrouter");
    expect(resolveJevProvider()).toBe("openrouter");
    expect(defaultModelForProvider("openrouter")).toBe("typesafe/jev-1.13");
    expect(defaultEndpointForProvider("openrouter")).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(credentialEnvironmentForProvider("openrouter")).toEqual(["OPENROUTER_API_KEY"]);
  });

  it("supports the cloudflare provider", () => {
    vi.stubEnv("JEV_PROVIDER", "cloudflare");
    expect(resolveJevProvider()).toBe("cloudflare");
    expect(defaultModelForProvider("cloudflare")).toBe("typesafe/jev");
  });

  it("honours JEV_MODEL", () => {
    vi.stubEnv("JEV_MODEL", "jev-test");
    expect(defaultModelForProvider("typesafe")).toBe("jev-test");
  });
});

describe.each([
  ["typesafe", "https://api.typesafe.ai/v1/systemone"],
  ["vercel", "https://ai-gateway.vercel.sh/typesafe/v1/systemone"],
] as const)("%s provider", (provider, expectedEndpoint) => {
  it("uses the TypeSafe-compatible System One transport", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(expectedEndpoint);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "jev-test",
        state: { ticket: "hello" },
        questions: { urgent: { type: "fixture" } },
      });
      return new Response(JSON.stringify({
        model: "jev-test",
        answers: { urgent: { type: "noul", noul: 0.8 } },
        usage: { input_tokens: 10, output_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const client = createJevClient({
      provider,
      apiKey: "test-key",
      model: "jev-test",
      fetchImpl,
    });

    const response = await client.systemOne({
      state: { ticket: "hello" },
      questions: { urgent: { type: "fixture" } },
    });

    expect(response.answers).toEqual({ urgent: { type: "noul", noul: 0.8 } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});


describe("openrouter provider", () => {
  it("uses the native Decisions endpoint and OpenRouter credentials", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-test-key");

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://openrouter.ai/api/alpha/decisions");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer openrouter-test-key");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "typesafe/jev-1.13",
        state: { ticket: "hello" },
        questions: { urgent: { type: "fixture" } },
      });
      return new Response(JSON.stringify({
        id: "gen-dec-test",
        model: "typesafe/jev-1.13-20260917",
        provider: "TypeSafe",
        answers: { urgent: { type: "noul", noul: 0.8 } },
        usage: { input_tokens: 10, output_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const client = createJevClient({
      provider: "openrouter",
      fetchImpl,
    });

    const response = await client.systemOne({
      state: { ticket: "hello" },
      questions: { urgent: { type: "fixture" } },
    });

    expect(response).toEqual({
      model: "typesafe/jev-1.13-20260917",
      answers: { urgent: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("CloudflareJevClient", () => {
  it("sends Cloudflare's input envelope and unwraps its nested response", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "typesafe/jev",
        input: {
          state: { ticket: "hello" },
          questions: { urgent: { type: "fixture" } },
        },
      });
      return new Response(JSON.stringify({
        result: {
          state: "Completed",
          result: {
            model: "jev-1.13.0",
            answers: { urgent: { type: "noul", noul: 0.94 } },
            usage: { input_tokens: 10, output_tokens: 2 },
          },
          gatewayMetadata: { keySource: "Unified" },
        },
        success: true,
        errors: [],
        messages: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const client = new CloudflareJevClient({
      endpoint: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run",
      apiKey: "test-token",
      fetchImpl,
    });

    const response = await client.systemOne({
      state: { ticket: "hello" },
      questions: { urgent: { type: "fixture" } },
    });

    expect(response).toEqual({
      model: "jev-1.13.0",
      answers: { urgent: { type: "noul", noul: 0.94 } },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("routes through a named AI Gateway via cf-aig-gateway-id", async () => {
    const ok = new Response(JSON.stringify({
      result: { result: { model: "jev-1.13.0", answers: { urgent: { type: "noul", noul: 0.9 } } } },
      success: true,
    }), { status: 200, headers: { "content-type": "application/json" } });
    const fetchImpl = vi.fn(async () => ok.clone()) as unknown as typeof fetch;
    const headersOf = (call: number) => new Headers((fetchImpl as any).mock.calls[call][1].headers);
    const request = { state: "hello", questions: { urgent: { type: "fixture" } } };
    const base = { endpoint: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run", apiKey: "test-token", fetchImpl };

    await new CloudflareJevClient(base).systemOne(request);
    expect(headersOf(0).get("cf-aig-gateway-id")).toBeNull();

    await new CloudflareJevClient({ ...base, gatewayId: "my-gateway" }).systemOne(request);
    expect(headersOf(1).get("cf-aig-gateway-id")).toBe("my-gateway");

    vi.stubEnv("CLOUDFLARE_GATEWAY_ID", "env-gateway");
    await new CloudflareJevClient(base).systemOne(request);
    expect(headersOf(2).get("cf-aig-gateway-id")).toBe("env-gateway");
  });

  it("lets a mixed-case headers override replace cf-aig-gateway-id instead of combining with it", async () => {
    const ok = new Response(JSON.stringify({
      result: { result: { model: "jev-1.13.0", answers: { urgent: { type: "noul", noul: 0.9 } } } },
      success: true,
    }), { status: 200, headers: { "content-type": "application/json" } });
    const fetchImpl = vi.fn(async () => ok.clone()) as unknown as typeof fetch;

    await new CloudflareJevClient({
      endpoint: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run",
      apiKey: "test-token",
      fetchImpl,
      gatewayId: "my-gateway",
      headers: { "CF-AIG-GATEWAY-ID": "override-gateway" },
    }).systemOne({ state: "hello", questions: { urgent: { type: "fixture" } } });

    const sent = (fetchImpl as any).mock.calls[0][1].headers as Record<string, string>;
    const gatewayEntries = Object.entries(sent).filter(([name]) => name.toLowerCase() === "cf-aig-gateway-id");
    expect(gatewayEntries).toEqual([["cf-aig-gateway-id", "override-gateway"]]);
    expect(new Headers(sent).get("cf-aig-gateway-id")).toBe("override-gateway");
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
        answers: { urgent: { type: "noul", noul: 0.8 } },
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

    expect(response.answers).toEqual({ urgent: { type: "noul", noul: 0.8 } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});


describe("response validation", () => {
  it("rejects malformed provider answers at the client boundary", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "jev-test",
      answers: { urgent: { noul: 1.2 } },
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const client = new FetchJevClient({
      endpoint: "https://example.test/v1/systemone",
      apiKey: "test-key",
      fetchImpl,
    });

    await expect(client.systemOne({
      state: "hello",
      questions: { urgent: { type: "fixture" } },
    })).rejects.toThrow('invalid answer for "urgent"');
  });
});


describe("response shape hardening", () => {
  it("rejects array-valued answers", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "jev-test",
      answers: [{ type: "noul", noul: 0.8 }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const client = new FetchJevClient({
      endpoint: "https://example.test/v1/systemone",
      apiKey: "test-key",
      fetchImpl,
    });

    await expect(client.systemOne({
      state: "hello",
      questions: { urgent: { type: "fixture" } },
    })).rejects.toThrow("did not contain an answer object");
  });

  it("preserves __proto__ as an own answer id without changing the result prototype", async () => {
    const payload = JSON.parse('{"model":"jev-test","answers":{"__proto__":{"type":"noul","noul":0.8}}}');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    const client = new FetchJevClient({
      endpoint: "https://example.test/v1/systemone",
      apiKey: "test-key",
      fetchImpl,
    });

    const response = await client.systemOne({
      state: "hello",
      questions: { "__proto__": { type: "fixture" } },
    });

    expect(Object.getPrototypeOf(response.answers)).toBe(Object.prototype);
    expect(Object.hasOwn(response.answers, "__proto__")).toBe(true);
    expect(response.answers["__proto__"]).toEqual({ type: "noul", noul: 0.8 });
  });
});
