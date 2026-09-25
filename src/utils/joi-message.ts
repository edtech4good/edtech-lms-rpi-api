/**
 * Rewrites a single Joi validation-detail message into plain language,
 * without touching the ~40 schema files under
 * src/**\/*.request.validator.ts (docs/api-errors.md: "fields from the Joi
 * details ... messages rewritten in plain language"). Joi's own wording
 * ("\"studentfirstname\" is required") is technical and quotes the raw key
 * name; this covers the handful of validator types Joi actually produces
 * here (required, string/number/date/email/pattern/min/max/valid) so every
 * schema gets a plain message for free. A schema that sets its own
 * `.messages()` override still flows through untouched (Joi's `type` for a
 * custom message is `any.custom`, which falls through to the generic case
 * below verbatim).
 */
export function humanizeJoiMessage(label: string, type: string, rawMessage: string): string {
  switch (type) {
    case 'any.required':
    case 'object.required':
      return `Enter a value for ${label}.`;
    case 'string.empty':
      return `${label} can't be empty.`;
    case 'string.email':
      return `Enter a valid email address for ${label}.`;
    case 'string.min':
    case 'string.max':
    case 'string.length':
    case 'array.min':
    case 'array.max':
    case 'array.length':
      return `${label} is the wrong length.`;
    case 'string.pattern.base':
    case 'string.alphanum':
      return `${label} contains characters that aren't allowed.`;
    case 'number.base':
    case 'string.base':
    case 'date.base':
    case 'boolean.base':
    case 'array.base':
    case 'object.base':
      return `${label} isn't the right type of value.`;
    case 'any.only':
      return `${label} isn't one of the allowed values.`;
    case 'number.min':
    case 'number.max':
      return `${label} is out of range.`;
    case 'date.format':
      return `${label} isn't a valid date.`;
    default:
      // Unknown Joi type (or a schema-level custom .messages() override):
      // fall back to Joi's own message rather than guess. Still never
      // echoes user-supplied VALUES back — Joi's default wording quotes
      // the field label, not the submitted value.
      return rawMessage;
  }
}

/** Best-effort field label from a Joi ValidationErrorItem's `path`. */
export function joiFieldLabel(path: Array<string | number>): string {
  return path.length > 0 ? path.map(String).join('.') : 'value';
}
