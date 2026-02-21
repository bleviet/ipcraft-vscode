import * as vscode from 'vscode';
import { Logger } from './Logger';

const logger = new Logger('ErrorHandler');

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
 * Handle an error without showing it to the user.
 */
export function handleError(error: Error | unknown, context: string): void {
  if (error instanceof ExtensionError) {
    logger.error(`[${error.code}] ${error.message} (context: ${context})`, error);
  } else if (error instanceof Error) {
    logger.error(`Error in ${context}: ${error.message}`, error);
  } else {
    logger.error(`Unknown error in ${context}`, new Error(String(error)));
  }
}

/**
 * Handle an error and show a notification to the user.
 */
export async function handleErrorWithUserNotification(
  error: Error | unknown,
  context: string,
  userMessage?: string
): Promise<void> {
  handleError(error, context);

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

  if (result === action) {
    Logger.show();
  }
}
