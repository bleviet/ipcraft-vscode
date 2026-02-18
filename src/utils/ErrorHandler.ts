import * as vscode from 'vscode';
import { Logger } from './Logger';

/**
 * Severity levels for extension errors
 */
export type ErrorSeverity = 'error' | 'warning' | 'info';

/**
 * Custom error class for extension-specific errors
 */
export class ExtensionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly severity: ErrorSeverity = 'error'
  ) {
    super(message);
    this.name = 'ExtensionError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ExtensionError);
    }
  }
}

/**
 * Error handler service for managing errors throughout the extension
 */
export class ErrorHandler {
  private static logger: Logger = new Logger('ErrorHandler');

  /**
   * Handle an error without showing it to the user
   * @param error The error to handle
   * @param context Context where the error occurred
   */
  static handle(error: Error | unknown, context: string): void {
    if (error instanceof ExtensionError) {
      this.logger.error(`[${error.code}] ${error.message} (context: ${context})`, error);
    } else if (error instanceof Error) {
      this.logger.error(`Error in ${context}: ${error.message}`, error);
    } else {
      this.logger.error(`Unknown error in ${context}`, new Error(String(error)));
    }
  }

  /**
   * Handle an error and show a notification to the user
   * @param error The error to handle
   * @param context Context where the error occurred
   * @param userMessage Optional custom message to show the user
   */
  static async handleWithUserNotification(
    error: Error | unknown,
    context: string,
    userMessage?: string
  ): Promise<void> {
    // Log the error
    this.handle(error, context);

    // Determine the message to show
    let message: string;
    let severity: ErrorSeverity = 'error';

    if (error instanceof ExtensionError) {
      message = userMessage ?? error.message;
      severity = error.severity;
    } else if (error instanceof Error) {
      message = userMessage ?? `An error occurred: ${error.message}`;
    } else {
      message = userMessage ?? 'An unknown error occurred';
    }

    // Show the notification
    const action = 'Show Logs';
    let result: string | undefined;

    switch (severity) {
      case 'error':
        result = await vscode.window.showErrorMessage(message, action);
        break;
      case 'warning':
        result = await vscode.window.showWarningMessage(message, action);
        break;
      case 'info':
        result = await vscode.window.showInformationMessage(message, action);
        break;
    }

    // If user clicked "Show Logs", show the output channel
    if (result === action) {
      Logger.show();
    }
  }

  /**
   * Wrap an async function with error handling
   * @param fn The async function to wrap
   * @param context Context for error reporting
   * @returns The result of the function or undefined if an error occurred
   */
  static async wrapAsync<T>(fn: () => Promise<T>, context: string): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      this.handle(error, context);
      return undefined;
    }
  }

  /**
   * Wrap an async function with error handling and user notification
   * @param fn The async function to wrap
   * @param context Context for error reporting
   * @param userMessage Optional custom message to show the user
   * @returns The result of the function or undefined if an error occurred
   */
  static async wrapAsyncWithNotification<T>(
    fn: () => Promise<T>,
    context: string,
    userMessage?: string
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      await this.handleWithUserNotification(error, context, userMessage);
      return undefined;
    }
  }

  /**
   * Create an ExtensionError
   * @param message Error message
   * @param code Error code
   * @param severity Error severity
   */
  static createError(
    message: string,
    code: string,
    severity: ErrorSeverity = 'error'
  ): ExtensionError {
    return new ExtensionError(message, code, severity);
  }

  /**
   * Check if an error is an ExtensionError
   */
  static isExtensionError(error: unknown): error is ExtensionError {
    return error instanceof ExtensionError;
  }
}
