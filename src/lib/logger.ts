type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: string | number | boolean | undefined | null;
}

function formatMessage(level: LogLevel, source: string, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const ctx = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}${ctx}`;
}

export function logDebug(source: string, message: string, context?: LogContext) {
  if (process.env.NODE_ENV !== "production") {
    console.debug(formatMessage("debug", source, message, context));
  }
}

export function logInfo(source: string, message: string, context?: LogContext) {
  console.log(formatMessage("info", source, message, context));
}

export function logWarn(source: string, message: string, context?: LogContext) {
  console.warn(formatMessage("warn", source, message, context));
}

export function logError(source: string, error: Error | string, context?: LogContext) {
  const message = typeof error === "string" ? error : error.message;
  const stack = typeof error === "object" && error.stack ? { stack: error.stack.split("\n").slice(0, 5).join(" | ") } : {};
  console.error(formatMessage("error", source, message, { ...context, ...stack }));
  // Sentry error capture is handled by sentry.server.config.ts / sentry.client.config.ts.
  // Do NOT require("@sentry/nextjs") here — it breaks webpack when the package is absent.
}

export function logSecurity(event: string, details: LogContext) {
  logWarn("security", event, details);
}

export function logAudit(userId: string, action: string, details?: LogContext) {
  logInfo("audit", action, { userId, ...details });
}
