import {logger as firebaseLogger} from "firebase-functions/v2";
import devConsole from "./_console.js";

const logger = process.env.ENVIRONMENT === "development" ? devConsole : firebaseLogger;

// Add additional severity methods only if using Firebase logger
if (logger === firebaseLogger) {
  // Helper to format arguments for write()
  const formatMessage = (args) => {
    // Single object argument - pass through directly
    if (args.length === 1 && typeof args[0] === "object") {
      return args[0];
    }

    // Convert all args to strings (objects become JSON)
    const message = args.map((arg) =>
      typeof arg === "object" ? JSON.stringify(arg) : String(arg),
    ).join(" ");

    return {message};
  };

  // Add critical, alert, and emergency methods using Firebase's write()
  logger.critical = function(...args) {
    return this.write({severity: "CRITICAL", ...formatMessage(args)});
  };

  logger.alert = function(...args) {
    return this.write({severity: "ALERT", ...formatMessage(args)});
  };

  logger.emergency = function(...args) {
    return this.write({severity: "EMERGENCY", ...formatMessage(args)});
  };
}

export default logger;
