/**
 * General utility functions
 */

/**
 * Checks if an error is a retryable network error
 * @param {Error} err - The error to check
 * @return {boolean} - True if the error is a retryable network error
 */
export function isNetworkError(err) {
  if (!err) return false;

  // Check error codes
  if (err.code === "ECONNRESET" ||
      err.code === "ETIMEDOUT" ||
      err.code === "ENOTFOUND" ||
      err.code === "ECONNREFUSED") {
    return true;
  }

  // Check error messages
  if (err.message && (
    err.message.includes("socket disconnected") ||
    err.message.includes("TLS connection") ||
    err.message.includes("ECONNRESET") ||
    err.message.includes("ETIMEDOUT") ||
    err.message.includes("ENOTFOUND") ||
    err.message.includes("network") ||
    err.message.includes("timeout")
  )) {
    return true;
  }

  return false;
}
