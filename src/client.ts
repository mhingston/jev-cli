import { TypeSafeClient } from "@typesafe-ai/sdk";
import { parseJevAnswer } from "./answers.js";
import type { SystemOneLikeClient, SystemOneRequest, SystemOneResponse } from "./types.js";

export const JEV_PROVIDERS = ["typesafe", "openrouter", "vercel", "cloudflare", "custom"] as const;
export type JevProvider = typeof JEV_PROVIDERS[number];


export interface JevClientOptions {
  provider?: JevProvider;
  apiKey?: string;
  accountId?: string;
  gatewayId?: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}


export const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const VERCEL_ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";

function endpointRoot(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.origin}${url.pathname.replace(/\/v1\/systemone\/?$/, "")}`.replace(/\/$/, "");
}

/** Later layers win. Names are normalized by `Headers`, so `CF-AIG-GATEWAY-ID` replaces `cf-aig-gateway-id` rather than being sent alongside it. */
function mergeHeaders(...layers: Array<Record<string, string> | undefined>): Record<string, string> {
  const merged = new Headers();
  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer ?? {})) merged.set(name, value);
  }
  return Object.fromEntries(merged);
}

function responsePayload(payload: any): SystemOneResponse {
  const body = payload?.data ?? payload;
  const value = body?.answers
    ? body
    : body?.result?.result?.answers
      ? body.result.result
      : body?.result?.answers
        ? body.result
        : body?.output?.answers
          ? body.output
          : body;
  if (!value || typeof value !== "object" || !value.answers || typeof value.answers !== "object" || Array.isArray(value.answers)) {
    throw new Error("Jev API response did not contain an answer object");
  }
  const answers: SystemOneResponse["answers"] = {};
  for (const [id, rawAnswer] of Object.entries(value.answers)) {
    const answer = parseJevAnswer(rawAnswer);
    if (!answer) throw new Error(`Jev API response contained an invalid answer for "${id}"`);
    Object.defineProperty(answers, id, {
      value: answer,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return {
    model: typeof value.model === "string" ? value.model : "jev",
    answers,
    usage: value.usage,
  };
}

function errorMessage(body: any): string {
  return body?.error?.message ?? body?.errors?.[0]?.message ?? body?.message ?? "request failed";
}

export function resolveJevProvider(options: JevClientOptions = {}): JevProvider {
  if (options.provider) return options.provider;
  const env = process.env.JEV_PROVIDER?.trim().toLowerCase();
  if (env && JEV_PROVIDERS.includes(env as JevProvider)) return env as JevProvider;
  return "typesafe";
}


export function defaultModelForProvider(provider: JevProvider): string {
  const override = process.env.JEV_MODEL?.trim();
  if (override) return override;
  switch (provider) {
    case "typesafe":
      return process.env.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-1.13.0";
    case "openrouter":
      return "typesafe/jev-1.13";
    case "vercel":
      return "typesafe-ai/jev";
    case "cloudflare":
      return "typesafe/jev";
    case "custom":
      return process.env.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-1.13.0";
  }
}

export function credentialEnvironmentForProvider(provider: JevProvider): string[] {
  switch (provider) {
    case "typesafe": return ["TYPESAFE_API_KEY"];
    case "openrouter": return ["OPENROUTER_API_KEY"];
    case "vercel": return ["AI_GATEWAY_API_KEY"];
    case "cloudflare": return ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
    case "custom": return ["JEV_API_KEY"];
  }
}

function defaultApiKey(provider: JevProvider): string | undefined {
  switch (provider) {
    case "typesafe": return process.env.TYPESAFE_API_KEY;
    case "openrouter": return process.env.OPENROUTER_API_KEY;
    case "vercel": return process.env.AI_GATEWAY_API_KEY;
    case "cloudflare": return process.env.CLOUDFLARE_API_TOKEN;
    case "custom": return process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY;
  }
}

export function defaultEndpointForProvider(provider: JevProvider, accountId?: string): string {
  const override = process.env.JEV_ENDPOINT?.trim();
  if (override) return override;
  switch (provider) {
    case "typesafe":
      return process.env.TYPESAFE_BASE_URL?.trim() || DEFAULT_ENDPOINT;
    case "openrouter":
      return OPENROUTER_ENDPOINT;
    case "vercel":
      return VERCEL_ENDPOINT;
    case "cloudflare": {
      const id = accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
      if (!id) throw new Error("CLOUDFLARE_ACCOUNT_ID is required for the cloudflare provider unless --endpoint is supplied");
      return `https://api.cloudflare.com/client/v4/accounts/${id}/ai/run`;
    }
    case "custom":
      return DEFAULT_ENDPOINT;
  }
}

class TypeSafeCompatibleJevClient implements SystemOneLikeClient {
  private readonly client: TypeSafeClient;
  private readonly model: string;

  constructor(provider: "typesafe" | "vercel", options: JevClientOptions = {}) {
    const apiKey = options.apiKey ?? defaultApiKey(provider);
    if (!apiKey) {
      throw new Error(provider === "vercel"
        ? "AI_GATEWAY_API_KEY is required for the vercel provider"
        : "TYPESAFE_API_KEY is required for the typesafe provider");
    }
    const endpoint = options.endpoint ?? defaultEndpointForProvider(provider, options.accountId);
    this.model = options.model ?? defaultModelForProvider(provider);
    this.client = new TypeSafeClient({
      apiKey,
      baseURL: endpointRoot(endpoint),
      defaultModel: this.model,
      timeout: options.timeoutMs,
      defaultHeaders: options.headers,
      ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
    });
  }

  async systemOne(request: SystemOneRequest): Promise<SystemOneResponse> {
    const response = await this.client.systemOne({ ...request, model: this.model } as any);
    return responsePayload(response);
  }
}

export class FetchJevClient implements SystemOneLikeClient {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JevClientOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.apiKey = options.apiKey ?? defaultApiKey("custom");
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.headers = mergeHeaders({ "content-type": "application/json" }, options.headers);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async systemOne(request: SystemOneRequest): Promise<SystemOneResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          ...this.headers,
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ ...request, ...(this.model ? { model: this.model } : {}) }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(`Jev API ${response.status}: ${errorMessage(body)}`);
      return responsePayload(body);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Jev API timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class CloudflareJevClient implements SystemOneLikeClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JevClientOptions = {}) {
    this.endpoint = options.endpoint ?? defaultEndpointForProvider("cloudflare", options.accountId);
    const apiKey = options.apiKey ?? defaultApiKey("cloudflare");
    if (!apiKey) throw new Error("CLOUDFLARE_API_TOKEN is required for the cloudflare provider");
    this.apiKey = apiKey;
    this.model = options.model ?? defaultModelForProvider("cloudflare");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const gatewayId = options.gatewayId ?? process.env.CLOUDFLARE_GATEWAY_ID?.trim();
    this.headers = mergeHeaders(
      { "content-type": "application/json" },
      gatewayId ? { "cf-aig-gateway-id": gatewayId } : undefined,
      options.headers,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async systemOne(request: SystemOneRequest): Promise<SystemOneResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { ...this.headers, authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          input: { state: request.state, questions: request.questions },
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(`Jev API ${response.status}: ${errorMessage(body)}`);
      return responsePayload(body);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Jev API timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createJevClient(options: JevClientOptions = {}): SystemOneLikeClient {
  const provider = resolveJevProvider(options);
  if (provider === "cloudflare") return new CloudflareJevClient(options);
  if (provider === "openrouter") {
    return new FetchJevClient({
      ...options,
      apiKey: options.apiKey ?? defaultApiKey("openrouter"),
      endpoint: options.endpoint ?? defaultEndpointForProvider("openrouter", options.accountId),
      model: options.model ?? defaultModelForProvider("openrouter"),
    });
  }
  if (provider === "custom") {
    return new FetchJevClient({
      ...options,
      endpoint: options.endpoint ?? process.env.JEV_ENDPOINT ?? DEFAULT_ENDPOINT,
      model: options.model ?? process.env.JEV_MODEL,
    });
  }
  return new TypeSafeCompatibleJevClient(provider, options);
}
