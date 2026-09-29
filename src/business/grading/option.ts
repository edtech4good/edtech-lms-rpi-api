/**
 * Loose, defensive access to the `questionoptions` JSON blob stored on a
 * `questions` row (src/models/data-models/questions.ts) / the
 * QuestionOption shape (src/models/questionoption.model.ts). Production
 * rows have been observed storing `questionoptionvalue` as a string (e.g.
 * "7") even though the Sequelize model types it as a number, so every
 * field here is read defensively rather than trusted from a type.
 */
export interface GradingOption {
  questionoptionid: string;
  questionoptiontext?: string;
  questionoptioniscorrect: boolean;
  questionoptionsequence?: number;
  questionoptionvalue?: number;
  questionoptionnumeratorvalue?: string;
  questionoptionnumeratorisstatic: boolean;
  questionoptiondenominatorvalue?: string;
  questionoptiondenominatorisstatic: boolean;
  questionoptionisfraction: boolean;
  questionoptionistext: boolean;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asBool(v: unknown): boolean {
  return v === true;
}

/** Numbers have been seen stored as JSON strings; read either. */
function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Numeric-or-text value fields (questionoptionvalue, numerator/denominator
 * values) are read as strings when present, since FOption1/FOption4 compare
 * them against typed text and Fraction compares them against typed digits;
 * gradeDOption3/4 additionally parse them as numbers via asNumber above. */
function asNumericString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/**
 * Parses one raw option object into a GradingOption, or returns undefined
 * if it has no usable id (such an entry cannot be an answer target and is
 * dropped rather than failing the whole question).
 */
function parseOption(raw: unknown): GradingOption | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const id = asString(o.questionoptionid);
  if (!id) return undefined;
  return {
    questionoptionid: id,
    questionoptiontext: asString(o.questionoptiontext),
    questionoptioniscorrect: asBool(o.questionoptioniscorrect),
    questionoptionsequence: asNumber(o.questionoptionsequence),
    questionoptionvalue: asNumber(o.questionoptionvalue),
    questionoptionnumeratorvalue: asNumericString(o.questionoptionnumeratorvalue),
    questionoptionnumeratorisstatic: asBool(o.questionoptionnumeratorisstatic),
    questionoptiondenominatorvalue: asNumericString(o.questionoptiondenominatorvalue),
    questionoptiondenominatorisstatic: asBool(o.questionoptiondenominatorisstatic),
    questionoptionisfraction: asBool(o.questionoptionisfraction),
    questionoptionistext: asBool(o.questionoptionistext),
  };
}

/**
 * Parses `questions.questionoptions` (a JSON column: an array, or a JSON
 * string of one depending on caller). Returns undefined when the shape is
 * not a parseable array at all — a question data problem, not an answer
 * problem, so callers surface it as `malformed`.
 */
export function parseOptions(raw: unknown): GradingOption[] | undefined {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(value)) return undefined;
  const options: GradingOption[] = [];
  for (const entry of value) {
    const parsed = parseOption(entry);
    if (parsed) options.push(parsed);
  }
  return options;
}
