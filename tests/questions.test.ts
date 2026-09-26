import { describe, expect, it } from "vitest";
import {
  buildQuestion,
  buildQuestions,
  validateQuestionSpec,
  validateQuestionSpecs,
} from "../src/questions.js";

describe("question builders", () => {
  it("builds a mixed batch", () => {
    const questions = buildQuestions({
      urgent: { type: "noul", instructions: "Does this communicate urgency?" },
      queue: {
        type: "choice",
        instructions: "Which queue fits best?",
        choices: { billing: "Billing issue", technical: "Technical issue" },
      },
      intensity: {
        type: "score",
        instructions: "How intense is the message?",
        levels: ["low", "medium", "high"],
      },
    });
    expect(Object.keys(questions)).toEqual(["urgent", "queue", "intensity"]);
  });

  it("rejects underspecified choice questions", () => {
    expect(() => buildQuestion({
      type: "choice",
      instructions: "Pick one",
      choices: { only: "Only option" },
    })).toThrow(/at least two/);
  });

  it("rejects underspecified score questions", () => {
    expect(() => buildQuestion({
      type: "score",
      instructions: "Score this",
      levels: ["only"],
    })).toThrow(/at least two/);
  });
});

describe("runtime question validation", () => {
  it("returns typed specs for valid dynamic input", () => {
    expect(validateQuestionSpec({
      type: "noul",
      instructions: "Is this urgent?",
      labels: { true: "Urgent", false: "Not urgent" },
    })).toEqual({
      type: "noul",
      instructions: "Is this urgent?",
      labels: { true: "Urgent", false: "Not urgent" },
    });
  });

  it("reports a precise path for a missing instruction", () => {
    expect(() => validateQuestionSpecs({
      routing: {
        type: "choice",
        choices: { billing: "Billing", other: "Anything else" },
      },
    })).toThrow("questions.routing.instructions must be a non-empty string");
  });

  it("rejects invalid nested choice values before the SDK boundary", () => {
    expect(() => buildQuestions({
      routing: {
        type: "choice",
        instructions: "Which queue fits?",
        choices: { billing: 42, other: "Anything else" },
      },
    })).toThrow("questions.routing.choices.billing must be a string or null");
  });

  it("rejects unsupported noul label keys instead of silently ignoring them", () => {
    expect(() => validateQuestionSpec({
      type: "noul",
      instructions: "Is this urgent?",
      labels: { yes: "Urgent" },
    })).toThrow('question.labels.yes is not supported; expected only "true" and "false"');
  });

  it("rejects invalid primitive names with a path-aware error", () => {
    expect(() => validateQuestionSpecs({
      result: {
        type: "boolean",
        instructions: "Is this urgent?",
      },
    })).toThrow('questions.result.type must be one of "noul", "choice", or "score"');
  });

  it("rejects non-string score levels with their index", () => {
    expect(() => validateQuestionSpecs({
      severity: {
        type: "score",
        instructions: "How severe is this?",
        levels: ["low", 2, "high"],
      },
    })).toThrow("questions.severity.levels[1] must be a string");
  });

  it("rejects sparse score arrays instead of skipping holes", () => {
    expect(() => validateQuestionSpec({
      type: "score",
      instructions: "How severe is this?",
      levels: new Array(2),
    })).toThrow("question.levels[0] must be a string");
  });

  it("preserves a __proto__ choice id as an own property", () => {
    const choices = JSON.parse('{"__proto__":"Fallback","billing":"Billing"}') as unknown;
    const question = validateQuestionSpec({
      type: "choice",
      instructions: "Which queue fits?",
      choices,
    });

    expect(question.type).toBe("choice");
    if (question.type !== "choice") throw new Error("expected choice question");
    expect(Object.hasOwn(question.choices, "__proto__")).toBe(true);
    expect(question.choices["__proto__"]).toBe("Fallback");
  });

  it("preserves a __proto__ question id through validation and building", () => {
    const specs = JSON.parse('{"__proto__":{"type":"noul","instructions":"Is this valid?"},"normal":{"type":"noul","instructions":"Is this normal?"}}') as unknown;

    const validated = validateQuestionSpecs(specs);
    const built = buildQuestions(specs);

    expect(Object.hasOwn(validated, "__proto__")).toBe(true);
    expect(Object.hasOwn(built, "__proto__")).toBe(true);
  });
});
