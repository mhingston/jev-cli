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
});
