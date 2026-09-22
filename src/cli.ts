#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  JEV_PROVIDERS,
  createJevClient,
  credentialEnvironmentForProvider,
  defaultModelForProvider,
  resolveJevProvider,
  type JevClientOptions,
  type JevProvider,
} from "./client.js";
import { buildQuestions, type QuestionSpec } from "./questions.js";

type Flags = Map<string, string[]>;

function usage(exitCode = 0): never {
  const text = `Usage:
  jev noul   --question <text> [state options] [provider options]
  jev choice --question <text> --choices <json> [state options] [provider options]
  jev score  --question <text> --levels <json> [state options] [provider options]
  jev run    (--questions <json> | --questions-file <path>) [state options] [provider options]
  jev doctor [provider options]

State options:
  --state <text|json>          State inline. JSON is parsed when valid.
  --state-file <path>         Read state from a file. JSON is parsed when valid.
                              If omitted, state is read from stdin.

Question options:
  --true-label <text>         Optional Noul true criterion.
  --false-label <text>        Optional Noul false criterion.
  --choices <json>            Choice map.
  --levels <json>             Ordered Score levels.
  --questions <json>          Batch question specs keyed by output id.
  --questions-file <path>     Read batch question specs from JSON.

Provider options:
  --provider <typesafe|openrouter|vercel|cloudflare|custom>
  --model <id>
  --endpoint <url>
  --account-id <id>           Cloudflare account id; env is preferred.
  --gateway-id <id>           Cloudflare AI Gateway id (cf-aig-gateway-id); env is preferred.

Output options:
  --answer-only               Print only the answer for single-question commands.
  --compact                   Emit compact JSON.

Credentials are read from environment variables, not command-line flags.`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseFlags(args: string[]): Flags {
  const flags = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`unexpected positional argument: ${token}`);
    const next = args[index + 1];
    if (next != null && !next.startsWith("--")) {
      const values = flags.get(token) ?? [];
      values.push(next);
      flags.set(token, values);
      index += 1;
    } else {
      flags.set(token, []);
    }
  }
  return flags;
}

function hasFlag(flags: Flags, name: string): boolean {
  return flags.has(name);
}

function flagValue(flags: Flags, name: string): string | undefined {
  const values = flags.get(name);
  return values?.[values.length - 1];
}

function requiredFlag(flags: Flags, name: string): string {
  const value = flagValue(flags, name);
  if (value == null) throw new Error(`${name} is required`);
  return value;
}

function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

async function readStdin(): Promise<string> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function readState(flags: Flags): Promise<unknown> {
  const inline = flagValue(flags, "--state");
  const file = flagValue(flags, "--state-file");
  if (inline != null && file != null) throw new Error("use --state or --state-file, not both");
  if (inline != null) return parseMaybeJson(inline);
  if (file != null) return parseMaybeJson(await readFile(file, "utf8"));
  if (process.stdin.isTTY) throw new Error("state is required via --state, --state-file, or stdin");
  const stdin = await readStdin();
  if (!stdin.trim()) throw new Error("stdin did not contain state");
  return parseMaybeJson(stdin);
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

async function readQuestions(flags: Flags): Promise<Record<string, QuestionSpec>> {
  const inline = flagValue(flags, "--questions");
  const file = flagValue(flags, "--questions-file");
  if ((inline == null) === (file == null)) {
    throw new Error("provide exactly one of --questions or --questions-file");
  }
  const text = inline ?? await readFile(file!, "utf8");
  const value = parseJson<unknown>(text, "questions");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("questions must be a JSON object keyed by question id");
  }
  return value as Record<string, QuestionSpec>;
}

function clientOptions(flags: Flags): JevClientOptions {
  const providerText = flagValue(flags, "--provider");
  if (providerText != null && !JEV_PROVIDERS.includes(providerText as JevProvider)) {
    throw new Error(`--provider must be one of ${JEV_PROVIDERS.join(", ")}`);
  }
  return {
    provider: providerText as JevProvider | undefined,
    model: flagValue(flags, "--model"),
    endpoint: flagValue(flags, "--endpoint"),
    accountId: flagValue(flags, "--account-id"),
    gatewayId: flagValue(flags, "--gateway-id"),
  };
}

function output(value: unknown, compact: boolean): void {
  console.log(JSON.stringify(value, null, compact ? 0 : 2));
}

async function runQuestion(
  state: unknown,
  specs: Record<string, QuestionSpec>,
  flags: Flags,
  answerOnly: boolean,
): Promise<void> {
  const options = clientOptions(flags);
  const provider = resolveJevProvider(options);
  const model = options.model ?? defaultModelForProvider(provider);
  const client = createJevClient(options);
  const response = await client.systemOne({ model, state, questions: buildQuestions(specs) });
  if (answerOnly && Object.keys(specs).length === 1) {
    const key = Object.keys(specs)[0];
    output(response.answers[key], hasFlag(flags, "--compact"));
    return;
  }
  output(response, hasFlag(flags, "--compact"));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h" || command === "help") usage(0);
  const flags = parseFlags(rest);

  if (command === "doctor") {
    const options = clientOptions(flags);
    const provider = resolveJevProvider(options);
    const credentialEnvironment = credentialEnvironmentForProvider(provider);
    output({
      provider,
      model: options.model ?? defaultModelForProvider(provider),
      credentials: Object.fromEntries(credentialEnvironment.map((name) => [name, Boolean(process.env[name])])),
      endpointOverride: Boolean(options.endpoint ?? process.env.JEV_ENDPOINT),
    }, hasFlag(flags, "--compact"));
    return;
  }

  const state = await readState(flags);

  if (command === "noul") {
    await runQuestion(state, {
      result: {
        type: "noul",
        instructions: requiredFlag(flags, "--question"),
        ...(flagValue(flags, "--true-label") != null || flagValue(flags, "--false-label") != null
          ? { labels: { true: flagValue(flags, "--true-label"), false: flagValue(flags, "--false-label") } }
          : {}),
      },
    }, flags, hasFlag(flags, "--answer-only"));
    return;
  }

  if (command === "choice") {
    const choices = parseJson<unknown>(requiredFlag(flags, "--choices"), "--choices");
    if (!choices || typeof choices !== "object" || Array.isArray(choices)) {
      throw new Error("--choices must be a JSON object");
    }
    await runQuestion(state, {
      result: {
        type: "choice",
        instructions: requiredFlag(flags, "--question"),
        choices: choices as Record<string, string | null>,
      },
    }, flags, hasFlag(flags, "--answer-only"));
    return;
  }

  if (command === "score") {
    const levels = parseJson<unknown>(requiredFlag(flags, "--levels"), "--levels");
    if (!Array.isArray(levels) || levels.some((item) => typeof item !== "string")) {
      throw new Error("--levels must be a JSON array of strings");
    }
    await runQuestion(state, {
      result: {
        type: "score",
        instructions: requiredFlag(flags, "--question"),
        levels: levels as string[],
      },
    }, flags, hasFlag(flags, "--answer-only"));
    return;
  }

  if (command === "run") {
    await runQuestion(state, await readQuestions(flags), flags, false);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`jev: ${message}`);
  process.exitCode = 1;
});
