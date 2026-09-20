import { describe, expect, it } from "vitest";
import { buildQuestion, buildQuestions } from "../src/questions.js";

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
