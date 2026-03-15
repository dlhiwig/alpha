/**
 * Simple structured logger for SuperClaw
 * 
 * Provides pino-like interface with child loggers and structured output.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  component?: string;
  [key: string]: unknown;
}

interface Logger {
  debug(obj: object, msg?: string): void;
  debug(msg: string): void;
  info(obj: object, msg?: string): void;
  info(msg: string): void;
  warn(obj: object, msg?: string): void;
  warn(msg: string): void;
  error(obj: object, msg?: string): void;
  error(msg: string): void;
  child(context: LogContext): Logger;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Default log level from environment
const DEFAULT_LEVEL = (process.env.LOG_LEVEL as LogLevel) || 'info';

function createLogger(context: LogContext = {}, level: LogLevel = DEFAULT_LEVEL): Logger {
  const minLevel = LOG_LEVELS[level];

  const log = (logLevel: LogLevel, objOrMsg: object | string, msg?: string): void => {
    if (LOG_LEVELS[logLevel] < minLevel) return;

    const timestamp = new Date().toISOString();
    const prefix = context.component ? `[${context.component}]` : '';
    
    let output: object;
    let message: string;

    if (typeof objOrMsg === 'string') {
      message = objOrMsg;
      output = { ...context, msg: message };
    } else {
      message = msg || '';
      output = { ...context, ...objOrMsg, msg: message };
    }

    const logFn = logLevel === 'error' ? console.error :
                  logLevel === 'warn' ? console.warn :
                  logLevel === 'debug' ? console.debug :
                  console.log;

    // Structured JSON in production, pretty in dev
    if (process.env.NODE_ENV === 'production') {
      logFn(JSON.stringify({ level: logLevel, time: timestamp, ...output }));
    } else {
      const levelColor = logLevel === 'error' ? '\x1b[31m' :
                        logLevel === 'warn' ? '\x1b[33m' :
                        logLevel === 'debug' ? '\x1b[90m' :
                        '\x1b[36m';
      const reset = '\x1b[0m';
      
      const { msg: _, component: __, ...rest } = output as Record<string, unknown>;
      const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
      
      logFn(`${timestamp} ${levelColor}${logLevel.toUpperCase().padEnd(5)}${reset} ${prefix} ${message}${extra}`);
    }
  };

  return {
    debug: (objOrMsg: object | string, msg?: string) => log('debug', objOrMsg, msg),
    info: (objOrMsg: object | string, msg?: string) => log('info', objOrMsg, msg),
    warn: (objOrMsg: object | string, msg?: string) => log('warn', objOrMsg, msg),
    error: (objOrMsg: object | string, msg?: string) => log('error', objOrMsg, msg),
    child: (childContext: LogContext) => createLogger({ ...context, ...childContext }, level),
  };
}

export const logger = createLogger();
export default logger;
