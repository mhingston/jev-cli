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

function requireInstructions(instructions: string): void {
  if (!instructions.trim()) throw new Error("question instructions must not be empty");
}

export function buildQuestion(spec: QuestionSpec): unknown {
  requireInstructions(spec.instructions);

  if (spec.type === "noul") {
    if (!spec.labels) return noul(spec.instructions);
    return noul(spec.instructions, {
      true: spec.labels.true ?? "The condition is true.",
      false: spec.labels.false ?? "The condition is false.",
    });
  }

  if (spec.type === "choice") {
    const entries = Object.entries(spec.choices);
    if (entries.length < 2) throw new Error("choice questions require at least two choices");
    if (entries.length > 255) throw new Error("choice questions support at most 255 choices");
    if (entries.some(([id]) => !id.trim())) throw new Error("choice ids must not be empty");
    return choice(spec.instructions, spec.choices as Parameters<typeof choice>[1]);
  }

  if (spec.levels.length < 2) throw new Error("score questions require at least two levels");
  if (spec.levels.length > 10) throw new Error("score questions support at most ten levels");
  if (spec.levels.some((level) => !level.trim())) throw new Error("score levels must not be empty");
  return score(spec.instructions, spec.levels as unknown as Parameters<typeof score>[1]);
}

export function buildQuestions(specs: Record<string, QuestionSpec>): Record<string, unknown> {
  const entries = Object.entries(specs);
  if (!entries.length) throw new Error("at least one question is required");
  const result: Record<string, unknown> = {};
  for (const [id, spec] of entries) {
    if (!id.trim()) throw new Error("question ids must not be empty");
    result[id] = buildQuestion(spec);
  }
  return result;
}
