// Must mock vscode module before importing any modules that use it
jest.mock('vscode');

import {
  ExtensionError,
  handleError,
  handleErrorWithUserNotification,
} from '../../../utils/ErrorHandler';
import { Logger, LogLevel } from '../../../utils/Logger';
import * as vscode from 'vscode';

// Get mock functions from vscode mock
const mockShowErrorMessage = vscode.window.showErrorMessage as jest.Mock;
const mockShowWarningMessage = vscode.window.showWarningMessage as jest.Mock;
const mockShowInformationMessage = vscode.window.showInformationMessage as jest.Mock;

// Silence console output during tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
});

describe('ErrorHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Initialize Logger so ErrorHandler can use it
    Logger.initialize('Test Channel', LogLevel.DEBUG);
  });

  afterEach(() => {
    Logger.dispose();
  });

  describe('ExtensionError', () => {
    it('should create an extension error with code and severity', () => {
      const error = new ExtensionError('Test error', 'TEST_001', 'error');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_001');
      expect(error.severity).toBe('error');
      expect(error.name).toBe('ExtensionError');
    });

    it('should default to error severity', () => {
      const error = new ExtensionError('Test error', 'TEST_002');
      expect(error.severity).toBe('error');
    });
  });

  describe('handle', () => {
    it('should handle ExtensionError', () => {
      const error = new ExtensionError('Test error', 'TEST_003', 'warning');
      expect(() => handleError(error, 'TestContext')).not.toThrow();
    });

    it('should handle standard Error', () => {
      const error = new Error('Standard error');
      expect(() => handleError(error, 'TestContext')).not.toThrow();
    });

    it('should handle unknown errors', () => {
      expect(() => handleError('string error', 'TestContext')).not.toThrow();
      expect(() => handleError({ foo: 'bar' }, 'TestContext')).not.toThrow();
      expect(() => handleError(null, 'TestContext')).not.toThrow();
    });
  });

  describe('handleWithUserNotification', () => {
    it('should show error message for error severity', async () => {
      const error = new ExtensionError('Test error', 'TEST_004', 'error');
      mockShowErrorMessage.mockResolvedValue(undefined);

      await handleErrorWithUserNotification(error, 'TestContext');

      expect(mockShowErrorMessage).toHaveBeenCalledWith('Test error', 'Show Logs');
      expect(mockShowWarningMessage).not.toHaveBeenCalled();
      expect(mockShowInformationMessage).not.toHaveBeenCalled();
    });

    it('should show warning message for warning severity', async () => {
      const error = new ExtensionError('Test warning', 'TEST_005', 'warning');
      mockShowWarningMessage.mockResolvedValue(undefined);

      await handleErrorWithUserNotification(error, 'TestContext');

      expect(mockShowWarningMessage).toHaveBeenCalledWith('Test warning', 'Show Logs');
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('should show info message for info severity', async () => {
      const error = new ExtensionError('Test info', 'TEST_006', 'info');
      mockShowInformationMessage.mockResolvedValue(undefined);

      await handleErrorWithUserNotification(error, 'TestContext');

      expect(mockShowInformationMessage).toHaveBeenCalledWith('Test info', 'Show Logs');
    });

    it('should use custom user message when provided', async () => {
      const error = new Error('Technical error');
      mockShowErrorMessage.mockResolvedValue(undefined);

      await handleErrorWithUserNotification(error, 'TestContext', 'User-friendly error message');

      expect(mockShowErrorMessage).toHaveBeenCalledWith('User-friendly error message', 'Show Logs');
    });
  });
});
