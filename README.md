# Jev CLI

A small, provider-agnostic command-line interface and Node.js client for [TypeSafe AI Jev](https://typesafe.ai/).

The package owns the reusable Jev boundary: provider selection, System One transport, typed question construction, and the `jev` executable. Domain-specific tools such as [`jev-agent-browser`](https://github.com/mhingston/jev-agent-browser/tree/main) can depend on this package while keeping their own observation, policy, and execution loops.

## Install

```bash
npm install -g @mhingston5/jev-cli
```

Node.js 20 or newer is required.

```bash
export TYPESAFE_API_KEY="..."
jev noul \
  --state "Please refund this today" \
  --question "Does the message communicate urgency?"
```

The CLI never accepts API keys as command-line arguments. Supply credentials through environment variables or your secret manager.

## Commands

### Noul

```bash
jev noul \
  --state '{"ticket":"Please fix this ASAP"}' \
  --question "Does this communicate urgency?" \
  --answer-only
```

### Choice

```bash
jev choice \
  --state '{"ticket":"I was charged twice"}' \
  --question "Which team should handle this?" \
  --choices '{"billing":"Payments and refunds","technical":"Bugs and outages","other":"Anything else"}'
```

### Score

```bash
jev score \
  --state "The service is unusable and blocking production" \
  --question "How severe is this?" \
  --levels '["minor","degraded","blocking"]'
```

### Batch

```bash
cat ticket.json | jev run --questions '{
  "urgent": {
    "type": "noul",
    "instructions": "Does the ticket communicate urgency?"
  },
  "queue": {
    "type": "choice",
    "instructions": "Which team should handle this?",
    "choices": {
      "billing": "Payments and refunds",
      "technical": "Bugs and outages"
    }
  },
  "severity": {
    "type": "score",
    "instructions": "How severe is the impact?",
    "levels": ["minor", "degraded", "blocking"]
  }
}'
```

Use `--questions-file questions.json` for checked-in question definitions. State can be supplied using `--state`, `--state-file`, or stdin.

## Providers

| Provider | CLI value | Credentials | Default model |
| --- | --- | --- | --- |
| TypeSafe | `typesafe` | `TYPESAFE_API_KEY` | `jev-1.13.0` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` |
| Vercel AI Gateway | `vercel` | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` |
| Cloudflare AI | `cloudflare` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, optional `CLOUDFLARE_GATEWAY_ID` | `typesafe/jev` |
| Custom | `custom` | `JEV_API_KEY` when required | caller-defined / Jev default |

Select the transport with `--provider` or `JEV_PROVIDER`. Override the model with `--model` or `JEV_MODEL`, and the endpoint with `--endpoint` or `JEV_ENDPOINT`.

Cloudflare routes through the account's `default` AI Gateway unless you name one with `--gateway-id` or `CLOUDFLARE_GATEWAY_ID` (sent as `cf-aig-gateway-id`). Use this when your TypeSafe key is stored (BYOK) on a specific gateway.

OpenRouter uses its native Decisions endpoint. Supply an OpenRouter API key and select the provider explicitly:

```bash
export OPENROUTER_API_KEY="..."
jev noul --provider openrouter \
  --state "Please refund this today" \
  --question "Does the message communicate urgency?"
```

```bash
jev doctor --provider openrouter
jev doctor --provider vercel
```

`doctor` reports provider/model configuration and whether expected credential environment variables are present. It never prints credential values.

## Library API

```ts
import { createJevClient, choice, noul, score } from "@mhingston5/jev-cli";

const client = createJevClient({ provider: "typesafe" });

const response = await client.systemOne({
  state: { ticket: "I was charged twice and need one charge refunded today." },
  questions: {
    intent: choice("What is the customer's main request?", {
      refund: "The customer wants money returned.",
      technical: "The customer needs technical help.",
    }),
    urgent: noul("Does the ticket explicitly communicate time pressure?"),
    severity: score("How severe is the impact?", ["minor", "degraded", "blocking"]),
  },
});

const urgent = response.answers.urgent;
if (urgent?.type === "noul") {
  console.log(urgent.noul);
}
```

Responses are normalized at the client boundary into the exported `JevAnswer` union (`NoulAnswer | ChoiceAnswer | ScoreAnswer`). Malformed provider answers fail the request instead of leaking `unknown` into callers. The package also exports `parseJevAnswer()`, `parseNoulAnswer()`, `parseChoiceAnswer()`, and `parseScoreAnswer()` for validating raw values and test fixtures.

For dynamically constructed question definitions, `buildQuestion()` and `buildQuestions()` accept JSON-friendly specs. The package also exports `SystemOneLikeClient` so higher-level libraries can inject deterministic fixture clients in tests.


## Agent skill

The npm package includes `skills/jev-cli/SKILL.md` for coding agents that need guidance on selecting Jev primitives, shaping state, batching questions, interpreting confidence, and using the CLI safely. It is intentionally CLI-focused; domain-specific packages such as `jev-agent-browser` keep their own skills.


## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run pack:check
```

## Publishing

The `publish` workflow publishes `@mhingston5/jev-cli` on a `v*` tag or manual workflow dispatch. The first npm publication requires an `NPM_TOKEN` repository secret with permission to publish the package. After the package exists, the workflow can move to npm trusted publishing.

## License

MIT
