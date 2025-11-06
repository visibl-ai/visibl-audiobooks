/**
 * Sanitize a string to be used as a Firebase Realtime Database key
 * Firebase keys cannot contain: . # $ / [ ]
 * Normalizes special characters and underscores to spaces, then trims multiple spaces
 * @param {Object} params - Object containing the key to sanitize
 * @param {string} params.key - The key to sanitize
 * @return {string} The sanitized key
 */
function sanitizeFirebaseKey({key}) {
  if (typeof key !== "string") {
    return String(key);
  }
  // Replace underscores and invalid Firebase characters with spaces
  // Then collapse multiple spaces into single spaces and trim
  return key.replace(/[_.#$/[\]]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Sanitize an object's keys for Firebase storage
 * @param {Object} obj - The object to sanitize
 * @return {Object} Object with sanitized keys
 */
function sanitizeObjectKeys(obj) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const sanitizedKey = sanitizeFirebaseKey({key});
    sanitized[sanitizedKey] = value;
  }
  return sanitized;
}

export {
  sanitizeFirebaseKey,
  sanitizeObjectKeys,
};
