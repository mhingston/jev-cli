import { choice, noul, score } from "@typesafe-ai/sdk";

export type NoulQuestionSpec = {
  type: "noul";
  instructions: string;
  labels?: { true?: string; false?: string };
};

export type ChoiceQuestionSpec = {
  type: "choice";
  instructions: string;
  choices: Record<string, string | null>;
};

export type ScoreQuestionSpec = {
  type: "score";
  instructions: string;
  levels: string[];
};

export type QuestionSpec = NoulQuestionSpec | ChoiceQuestionSpec | ScoreQuestionSpec;

type UnknownRecord = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`${path} ${message}`);
}

function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function requireObject(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as UnknownRecord;
}

function requireInstructions(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function validateNoulLabels(value: unknown, path: string): NoulQuestionSpec["labels"] {
  const labels = requireObject(value, path);
  for (const key of Object.keys(labels)) {
    if (key !== "true" && key !== "false") {
      fail(`${path}.${key}`, 'is not supported; expected only "true" and "false"');
    }
  }

  const result: NonNullable<NoulQuestionSpec["labels"]> = {};
  if ("true" in labels) {
    if (typeof labels.true !== "string") fail(`${path}.true`, "must be a string");
    result.true = labels.true;
  }
  if ("false" in labels) {
    if (typeof labels.false !== "string") fail(`${path}.false`, "must be a string");
    result.false = labels.false;
  }
  return result;
}

export function validateQuestionSpec(value: unknown, path = "question"): QuestionSpec {
  const spec = requireObject(value, path);
  const type = spec.type;
  if (type !== "noul" && type !== "choice" && type !== "score") {
    fail(`${path}.type`, 'must be one of "noul", "choice", or "score"');
  }

  const instructions = requireInstructions(spec.instructions, `${path}.instructions`);

  if (type === "noul") {
    if (spec.labels === undefined) return { type, instructions };
    return {
      type,
      instructions,
      labels: validateNoulLabels(spec.labels, `${path}.labels`),
    };
  }

  if (type === "choice") {
    const choicesValue = requireObject(spec.choices, `${path}.choices`);
    const entries = Object.entries(choicesValue);
    if (entries.length < 2) fail(`${path}.choices`, "must contain at least two choices");
    if (entries.length > 255) fail(`${path}.choices`, "supports at most 255 choices");

    const choices: Record<string, string | null> = {};
    for (const [id, description] of entries) {
      if (!id.trim()) fail(`${path}.choices`, "must not contain an empty choice id");
      if (description !== null && typeof description !== "string") {
        fail(`${path}.choices.${id}`, "must be a string or null");
      }
      setOwn(choices, id, description);
    }
    return { type, instructions, choices };
  }

  if (!Array.isArray(spec.levels)) fail(`${path}.levels`, "must be an array of strings");
  if (spec.levels.length < 2) fail(`${path}.levels`, "must contain at least two levels");
  if (spec.levels.length > 10) fail(`${path}.levels`, "supports at most ten levels");

  const levels = Array.from(spec.levels, (level, index) => {
    if (typeof level !== "string") fail(`${path}.levels[${index}]`, "must be a string");
    if (!level.trim()) fail(`${path}.levels[${index}]`, "must not be empty");
    return level;
  });
  return { type, instructions, levels };
}

export function validateQuestionSpecs(value: unknown, path = "questions"): Record<string, QuestionSpec> {
  const specs = requireObject(value, path);
  const entries = Object.entries(specs);
  if (!entries.length) fail(path, "must contain at least one question");

  const result: Record<string, QuestionSpec> = {};
  for (const [id, spec] of entries) {
    if (!id.trim()) fail(path, "must not contain an empty question id");
    setOwn(result, id, validateQuestionSpec(spec, `${path}.${id}`));
  }
  return result;
}

function buildValidatedQuestion(spec: QuestionSpec): unknown {
  if (spec.type === "noul") {
    if (!spec.labels) return noul(spec.instructions);
    return noul(spec.instructions, {
      true: spec.labels.true ?? "The condition is true.",
      false: spec.labels.false ?? "The condition is false.",
    });
  }

  if (spec.type === "choice") {
    return choice(spec.instructions, spec.choices as Parameters<typeof choice>[1]);
  }

  return score(spec.instructions, spec.levels as unknown as Parameters<typeof score>[1]);
}

export function buildQuestion(spec: unknown): unknown {
  return buildValidatedQuestion(validateQuestionSpec(spec));
}

export function buildQuestions(specs: unknown): Record<string, unknown> {
  const validated = validateQuestionSpecs(specs);
  const result: Record<string, unknown> = {};
  for (const [id, spec] of Object.entries(validated)) {
    setOwn(result, id, buildValidatedQuestion(spec));
  }
  return result;
}
