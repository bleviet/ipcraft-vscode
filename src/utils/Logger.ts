import * as vscode from "vscode";

/**
 * Log levels for extension logging
 */
export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

/**
 * Logger service for structured logging throughout the extension
 */
export class Logger {
  private static outputChannel: vscode.OutputChannel | null = null;
  private static logLevel: LogLevel = LogLevel.INFO;

  constructor(private readonly context: string) {}

  /**
   * Initialize the logger with a VS Code output channel
   */
  static initialize(
    channelName: string,
    level: LogLevel = LogLevel.INFO,
  ): void {
    this.outputChannel = vscode.window.createOutputChannel(channelName);
    this.logLevel = level;
  }

  /**
   * Get the output channel (create if doesn't exist)
   */
  private static getChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel(
        "FPGA Memory Map Editor",
      );
    }
    return this.outputChannel;
  }

  /**
   * Set the global log level
   */
  static setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Write a message to the output channel
   */
  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    const channel = Logger.getChannel();
    const timestamp = new Date().toISOString();
    const formattedArgs = args.map((arg) => this.formatArg(arg)).join(" ");
    const logMessage = `[${timestamp}] [${level}] [${this.context}] ${message}${formattedArgs ? " " + formattedArgs : ""}`;

    channel?.appendLine(logMessage);

    // Also log to console in development
    if (process.env.NODE_ENV === "development") {
      const consoleMethod = this.getConsoleMethod(level);
      consoleMethod(`[${this.context}]`, message, ...args);
    }
  }

  /**
   * Format an argument for logging
   */
  private formatArg(arg: unknown): string {
    if (arg === null) {
      return "null";
    }
    if (arg === undefined) {
      return "undefined";
    }
    if (arg instanceof Error) {
      return `Error: ${arg.message}\n${arg.stack ?? ""}`;
    }
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }

  /**
   * Get the appropriate console method for a log level
   */
  private getConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
    switch (level) {
      case LogLevel.DEBUG:
        return console.debug;
      case LogLevel.INFO:
        return console.info;
      case LogLevel.WARN:
        return console.warn;
      case LogLevel.ERROR:
        return console.error;
      default:
        return console.log;
    }
  }

  /**
   * Check if a log level should be logged based on current log level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
    ];
    const currentIndex = levels.indexOf(Logger.logLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  /**
   * Log a debug message
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.log(LogLevel.DEBUG, message, ...args);
    }
  }

  /**
   * Log an info message
   */
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.log(LogLevel.INFO, message, ...args);
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.log(LogLevel.WARN, message, ...args);
    }
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const allArgs = error ? [error, ...args] : args;
      this.log(LogLevel.ERROR, message, ...allArgs);
    }
  }

  /**
   * Show the output channel
   */
  static show(): void {
    this.getChannel().show();
  }

  /**
   * Dispose of the output channel
   */
  static dispose(): void {
    this.outputChannel?.dispose();
    this.outputChannel = null;
  }
}
