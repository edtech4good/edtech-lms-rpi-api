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
    case 'object.unknown':
      // The schema here is the whole request ({ params, query, body }), so
      // `path` for this type is the attacker-chosen KEY name itself (an
      // arbitrary extra field), not a field this API defines — never echo
      // it back, even as a label.
      return "This request contains a field that isn't allowed.";
    default:
      // Unknown Joi type (or a schema-level custom .messages() override):
      // fall back to Joi's own message rather than guess. Still never
      // echoes user-supplied VALUES back — Joi's default wording quotes
      // the field label, not the submitted value.
      return rawMessage;
  }
}

/**
 * Best-effort field label from a Joi ValidationErrorItem's `path`, stripped
 * of the `body.`/`query.`/`params.` request-part segment: the schema
 * validated here is the whole `{ params, query, body }` object (see
 * SchemaValidationInterceptor), so Joi's own `path` always starts with one
 * of those three, which is plumbing the client never sent and shouldn't see
 * echoed back as part of a field name.
 */
const REQUEST_PART_SEGMENTS = new Set(['body', 'query', 'params']);

export function joiFieldLabel(path: Array<string | number>): string {
  const trimmed =
    path.length > 0 && REQUEST_PART_SEGMENTS.has(String(path[0])) ? path.slice(1) : path;
  return trimmed.length > 0 ? trimmed.map(String).join('.') : 'value';
}

/**
 * The `field` value for a single Joi ValidationErrorItem — almost always
 * `joiFieldLabel(path)`, EXCEPT for `object.unknown`, where `path`'s last
 * segment is the attacker-chosen key itself (an arbitrary extra field the
 * client sent, not one this API defines). That key must never reach the
 * response body, not even as a `fields[].field` value — so this falls back
 * to the request part it appeared under (`body`/`query`/`params`, i.e. the
 * path with the offending key dropped), never the key.
 */
export function fieldForJoiDetail(path: Array<string | number>, type: string): string {
  if (type === 'object.unknown') {
    return path.length > 0 ? String(path[0]) : 'body';
  }
  return joiFieldLabel(path);
}
