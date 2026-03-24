type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string | undefined;
  message: string;
  data?: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: LogLevel = 'debug';
  private enabled = true;

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabled && LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private format(entry: LogEntry): string {
    const parts = [`[${entry.timestamp}]`, `[${entry.level.toUpperCase().padEnd(5)}]`];
    if (entry.module) {
      parts.push(`[${entry.module}]`);
    }
    parts.push(entry.message);
    return parts.join(' ');
  }

  private log(level: LogLevel, message: string, module?: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data,
    };

    const formatted = this.format(entry);
    const consoleMethod = level === 'debug' ? 'log' : level;

    if (data !== undefined) {
      console[consoleMethod](formatted, data);
    } else {
      console[consoleMethod](formatted);
    }
  }

  debug(message: string, module?: string, data?: unknown): void {
    this.log('debug', message, module, data);
  }

  info(message: string, module?: string, data?: unknown): void {
    this.log('info', message, module, data);
  }

  warn(message: string, module?: string, data?: unknown): void {
    this.log('warn', message, module, data);
  }

  error(message: string, module?: string, data?: unknown): void {
    this.log('error', message, module, data);
  }
}

export const logger = new Logger();

export function createModuleLogger(module: string) {
  return {
    debug: (message: string, data?: unknown) => logger.debug(message, module, data),
    info: (message: string, data?: unknown) => logger.info(message, module, data),
    warn: (message: string, data?: unknown) => logger.warn(message, module, data),
    error: (message: string, data?: unknown) => logger.error(message, module, data),
  };
}
