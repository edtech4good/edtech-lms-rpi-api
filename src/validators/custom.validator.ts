import passwordSchema from 'password-validator';
import { CustomHelpers } from 'joi';

const passwordvalidator = (value: string, helpers: CustomHelpers) => {
  const passwordschemahelper = new passwordSchema();
  passwordschemahelper
    .is()
    .min(8) // Minimum length 8
    .is()
    .max(50) // Maximum length 100
    .has()
    .uppercase() // Must have uppercase letters
    .has()
    .lowercase() // Must have lowercase letters
    .has()
    .digits(1) // Must have at least 2 digits
    .has()
    .not()
    .spaces() // Should not have spaces
    .is()
    .not()
    .oneOf(['Passw0rd', 'Password123']);
  return passwordschemahelper.validate(value) === true
    ? value
    : helpers.message({
      'custom':
        'Invalid password, Required : Minimum length 8, Maximum length 100, Must have at least 1 uppercase letter, Must have at least 1 lowercase letter, Must have at least 1 digits, Should not have spaces',
    });
};

const emptyString = (name: string) => (value: string, helpers: CustomHelpers) => {
  if (!value) {
    return value;
  }

  return value.trim().length > 0 ? value : helpers.message({
    'custom':
      `${name} not allowed`,
  });
};

export { passwordvalidator, emptyString };
