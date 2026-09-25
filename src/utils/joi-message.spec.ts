import { humanizeJoiMessage, joiFieldLabel } from './joi-message';

/**
 * SchemaValidationInterceptor validates the whole `{ params, query, body }`
 * request object as one Joi schema (docs/api-errors.md's `fields` array),
 * so every real ValidationErrorItem's `path` starts with one of those three
 * segments — a client never typed "body" or "query", so it must never show
 * up in a field name the client sees.
 */
describe('joiFieldLabel', () => {
  it('strips a leading body/query/params segment', () => {
    expect(joiFieldLabel(['body', 'studentfirstname'])).toBe('studentfirstname');
    expect(joiFieldLabel(['query', 'schoolname'])).toBe('schoolname');
    expect(joiFieldLabel(['params', 'lessonid'])).toBe('lessonid');
  });

  it('keeps nested paths under the stripped segment', () => {
    expect(joiFieldLabel(['body', 'student', 'dateofbirth'])).toBe('student.dateofbirth');
  });

  it('does not touch a path that does not start with a request-part segment', () => {
    expect(joiFieldLabel(['studentfirstname'])).toBe('studentfirstname');
  });

  it('falls back to "value" for an empty path', () => {
    expect(joiFieldLabel([])).toBe('value');
  });
});

describe('humanizeJoiMessage', () => {
  it('object.unknown never echoes the (client-controlled) key name', () => {
    const message = humanizeJoiMessage('__proto__', 'object.unknown', '"__proto__" is not allowed');
    expect(message).toBe("This request contains a field that isn't allowed.");
    expect(message).not.toMatch(/__proto__/);
  });

  it('any.required uses the field label, not Joi\'s raw quoted-key wording', () => {
    expect(humanizeJoiMessage('email', 'any.required', '"email" is required')).toBe(
      'Enter a value for email.'
    );
  });

  it('falls back to the raw Joi message for an unrecognized type (e.g. a schema-level custom .messages() override)', () => {
    expect(humanizeJoiMessage('email', 'any.custom', 'a fully custom message')).toBe(
      'a fully custom message'
    );
  });
});
