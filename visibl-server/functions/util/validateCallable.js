/**
 * Validates callable function input data
 * @param {Object} data - The data object to validate
 * @param {Object} options - Validation options
 * @param {string[]} [options.required] - Fields that must be present
 * @param {string[]} [options.oneOf] - Exactly one of these fields must be present
 * @throws {Error} If validation fails
 */
export function validateCallable(data, {required = [], oneOf = []} = {}) {
  for (const field of required) {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(`${field} is required`);
    }
  }

  if (oneOf.length > 0) {
    const present = oneOf.filter((field) => data[field] !== undefined && data[field] !== null);
    if (present.length === 0) {
      throw new Error(`One of ${oneOf.join(", ")} is required`);
    }
    if (present.length > 1) {
      throw new Error(`Cannot provide both ${present.join(" and ")}`);
    }
  }
}
