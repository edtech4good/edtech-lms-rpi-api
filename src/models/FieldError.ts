/** One invalid-field entry in an `INVALID_INPUT` response's `fields` array. */
export interface FieldError {
  field: string;
  message: string;
}
