export interface NoulAnswer {
  readonly type: "noul";
  readonly noul: number;
}

export interface ChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  readonly type: "score";
  readonly score: number;
  readonly confidence: number;
  readonly legend: Record<string, string>;
  readonly probabilities: Record<string, number>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function probabilityMap(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record);
  if (!entries.length || entries.some(([, probability]) => !validProbability(probability))) return undefined;
  return Object.fromEntries(entries) as Record<string, number>;
}

function answerTypeMatches(
  record: Record<string, unknown>,
  expected: NoulAnswer["type"] | ChoiceAnswer["type"] | ScoreAnswer["type"],
): boolean {
  return !Object.hasOwn(record, "type") || record.type === expected;
}

/**
 * Parse a Jev Noul answer from an untrusted provider response.
 *
 * The type discriminator is optional because some compatible providers omit
 * it, but when present it must match the expected answer kind.
 */
export function parseNoulAnswer(value: unknown): NoulAnswer | undefined {
  const record = asRecord(value);
  if (!record || !answerTypeMatches(record, "noul") || !validProbability(record.noul)) return undefined;
  return { type: "noul", noul: record.noul };
}

/**
 * Parse a Jev Choice answer and validate its selected option and probability
 * distribution.
 */
export function parseChoiceAnswer(value: unknown): ChoiceAnswer | undefined {
  const record = asRecord(value);
  if (!record || !answerTypeMatches(record, "choice")) return undefined;
  if (typeof record.choice !== "string" || !record.choice.trim() || !validProbability(record.confidence)) return undefined;
  const probabilities = probabilityMap(record.probabilities);
  if (!probabilities || !Object.hasOwn(probabilities, record.choice)) return undefined;
  return {
    type: "choice",
    choice: record.choice,
    confidence: record.confidence,
    probabilities,
  };
}

/**
 * Parse a Jev Score answer and validate the rubric legend, probability
 * distribution, confidence, and expected score range.
 */
export function parseScoreAnswer(value: unknown): ScoreAnswer | undefined {
  const record = asRecord(value);
  if (!record || !answerTypeMatches(record, "score")) return undefined;
  if (typeof record.score !== "number" || !Number.isFinite(record.score) || !validProbability(record.confidence)) return undefined;

  const rawLegend = asRecord(record.legend);
  const probabilities = probabilityMap(record.probabilities);
  if (!rawLegend || Object.values(rawLegend).some((level) => typeof level !== "string") || !probabilities) return undefined;
  const legend = rawLegend as Record<string, string>;

  const legendKeys = Object.keys(legend);
  if (legendKeys.length < 2) return undefined;
  const indexes = legendKeys.map((key) => Number(key));
  if (indexes.some((index) => !Number.isInteger(index) || index < 0)) return undefined;
  indexes.sort((a, b) => a - b);
  if (indexes.some((index, position) => index !== position)) return undefined;

  const probabilityKeys = Object.keys(probabilities).sort((a, b) => Number(a) - Number(b));
  if (probabilityKeys.length !== legendKeys.length || probabilityKeys.some((key, index) => Number(key) !== index)) return undefined;

  const maxScore = indexes.length - 1;
  if (record.score < 0 || record.score > maxScore) return undefined;

  return {
    type: "score",
    score: record.score,
    confidence: record.confidence,
    legend: { ...legend },
    probabilities,
  };
}


export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** Parse any supported Jev answer shape into the canonical discriminated union. */
export function parseJevAnswer(value: unknown): JevAnswer | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const hasType = Object.hasOwn(record, "type");
  if (record.type === "noul" || (!hasType && Object.hasOwn(record, "noul"))) return parseNoulAnswer(record);
  if (record.type === "choice" || (!hasType && Object.hasOwn(record, "choice"))) return parseChoiceAnswer(record);
  if (record.type === "score" || (!hasType && Object.hasOwn(record, "score"))) return parseScoreAnswer(record);
  return undefined;
}
