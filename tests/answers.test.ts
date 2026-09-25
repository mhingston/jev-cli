import { describe, expect, it } from "vitest";
import { parseChoiceAnswer, parseNoulAnswer, parseScoreAnswer } from "../src/answers.js";

describe("parseNoulAnswer", () => {
  it("accepts canonical answers and compatible answers without a type discriminator", () => {
    expect(parseNoulAnswer({ type: "noul", noul: 0.82 })).toEqual({ type: "noul", noul: 0.82 });
    expect(parseNoulAnswer({ noul: 0.42 })).toEqual({ type: "noul", noul: 0.42 });
  });

  it("rejects malformed probabilities or the wrong answer type", () => {
    expect(parseNoulAnswer({ type: "choice", noul: 0.8 })).toBeUndefined();
    expect(parseNoulAnswer({ noul: 1.1 })).toBeUndefined();
    expect(parseNoulAnswer({ probability: 0.8 })).toBeUndefined();
  });
});

describe("parseChoiceAnswer", () => {
  it("returns a typed choice answer", () => {
    expect(parseChoiceAnswer({
      type: "choice",
      choice: "billing",
      confidence: 0.91,
      probabilities: { billing: 0.91, technical: 0.09 },
    })).toEqual({
      type: "choice",
      choice: "billing",
      confidence: 0.91,
      probabilities: { billing: 0.91, technical: 0.09 },
    });
  });

  it("accepts compatible answers without a type discriminator", () => {
    expect(parseChoiceAnswer({
      choice: "billing",
      confidence: 0.91,
      probabilities: { billing: 0.91, technical: 0.09 },
    })?.choice).toBe("billing");
  });

  it("rejects answers whose selected option is absent from the distribution", () => {
    expect(parseChoiceAnswer({
      choice: "billing",
      confidence: 0.91,
      probabilities: { technical: 1 },
    })).toBeUndefined();
  });

  it("rejects malformed confidence and probability values", () => {
    expect(parseChoiceAnswer({
      choice: "billing",
      confidence: 2,
      probabilities: { billing: 1 },
    })).toBeUndefined();
    expect(parseChoiceAnswer({
      choice: "billing",
      confidence: 1,
      probabilities: { billing: Number.NaN },
    })).toBeUndefined();
  });
});

describe("parseScoreAnswer", () => {
  it("returns a typed fractional score answer", () => {
    expect(parseScoreAnswer({
      type: "score",
      score: 1.78,
      confidence: 0.8,
      legend: { 0: "minor", 1: "degraded", 2: "blocking" },
      probabilities: { 0: 0, 1: 0.22, 2: 0.78 },
    })).toEqual({
      type: "score",
      score: 1.78,
      confidence: 0.8,
      legend: { 0: "minor", 1: "degraded", 2: "blocking" },
      probabilities: { 0: 0, 1: 0.22, 2: 0.78 },
    });
  });

  it("rejects non-contiguous legends or mismatched probability keys", () => {
    expect(parseScoreAnswer({
      score: 1,
      confidence: 0.8,
      legend: { 0: "minor", 2: "blocking" },
      probabilities: { 0: 0.5, 2: 0.5 },
    })).toBeUndefined();

    expect(parseScoreAnswer({
      score: 1,
      confidence: 0.8,
      legend: { 0: "minor", 1: "blocking" },
      probabilities: { 0: 0.5, 1: 0.4, 2: 0.1 },
    })).toBeUndefined();
  });

  it("rejects scores outside the rubric range", () => {
    expect(parseScoreAnswer({
      score: 2.1,
      confidence: 0.8,
      legend: { 0: "minor", 1: "blocking" },
      probabilities: { 0: 0.2, 1: 0.8 },
    })).toBeUndefined();
  });
});
