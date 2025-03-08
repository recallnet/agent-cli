/**
 * Logging utility for the application
 */

// Log levels
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 999
}

// Logger configuration
interface LoggerConfig {
  level: LogLevel;
  useColors: boolean;
  prefix?: string;
}

/**
 * Simple logging utility
 */
class Logger {
  private config: LoggerConfig = {
    level: LogLevel.INFO,
    useColors: true
  };

  /**
   * Configure the logger
   * @param config Logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set the log level
   * @param level The log level to set
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Format a log message with optional prefix
   * @param message The message content
   * @returns Formatted message
   */
  private formatMessage(message: string): string {
    return this.config.prefix 
      ? `[${this.config.prefix}] ${message}`
      : message;
  }

  /**
   * Log a debug message
   * @param message Message content
   * @param args Additional arguments
   */
  debug(message: string, ...args: any[]): void {
    if (this.config.level <= LogLevel.DEBUG) {
      const formattedMessage = this.formatMessage(message);
      if (this.config.useColors) {
        console.debug('\x1b[90m%s\x1b[0m', formattedMessage, ...args);
      } else {
        console.debug(formattedMessage, ...args);
      }
    }
  }

  /**
   * Log an info message
   * @param message Message content
   * @param args Additional arguments
   */
  info(message: string, ...args: any[]): void {
    if (this.config.level <= LogLevel.INFO) {
      const formattedMessage = this.formatMessage(message);
      if (this.config.useColors) {
        console.info('\x1b[36m%s\x1b[0m', formattedMessage, ...args);
      } else {
        console.info(formattedMessage, ...args);
      }
    }
  }

  /**
   * Log a warning message
   * @param message Message content
   * @param args Additional arguments
   */
  warn(message: string, ...args: any[]): void {
    if (this.config.level <= LogLevel.WARN) {
      const formattedMessage = this.formatMessage(message);
      if (this.config.useColors) {
        console.warn('\x1b[33m%s\x1b[0m', formattedMessage, ...args);
      } else {
        console.warn(formattedMessage, ...args);
      }
    }
  }

  /**
   * Log an error message
   * @param message Message content
   * @param args Additional arguments
   */
  error(message: string, ...args: any[]): void {
    if (this.config.level <= LogLevel.ERROR) {
      const formattedMessage = this.formatMessage(message);
      if (this.config.useColors) {
        console.error('\x1b[31m%s\x1b[0m', formattedMessage, ...args);
      } else {
        console.error(formattedMessage, ...args);
      }
    }
  }

  /**
   * Create a child logger with a specific prefix
   * @param prefix The prefix to add to all messages
   * @returns A new Logger instance with the prefix
   */
  child(prefix: string): Logger {
    const childLogger = new Logger();
    childLogger.configure({
      ...this.config,
      prefix: this.config.prefix 
        ? `${this.config.prefix}:${prefix}`
        : prefix
    });
    return childLogger;
  }
}

// Export a singleton instance
export const logger = new Logger(); 