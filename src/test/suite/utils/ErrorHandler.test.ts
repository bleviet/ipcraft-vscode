// Must mock vscode module before importing any modules that use it
jest.mock('vscode');

import { ErrorHandler, ExtensionError } from '../../../utils/ErrorHandler';
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
      expect(() => ErrorHandler.handle(error, 'TestContext')).not.toThrow();
    });

    it('should handle standard Error', () => {
      const error = new Error('Standard error');
      expect(() => ErrorHandler.handle(error, 'TestContext')).not.toThrow();
    });

    it('should handle unknown errors', () => {
      expect(() => ErrorHandler.handle('string error', 'TestContext')).not.toThrow();
      expect(() => ErrorHandler.handle({ foo: 'bar' }, 'TestContext')).not.toThrow();
      expect(() => ErrorHandler.handle(null, 'TestContext')).not.toThrow();
    });
  });

  describe('handleWithUserNotification', () => {
    it('should show error message for error severity', async () => {
      const error = new ExtensionError('Test error', 'TEST_004', 'error');
      mockShowErrorMessage.mockResolvedValue(undefined);

      await ErrorHandler.handleWithUserNotification(error, 'TestContext');

      expect(mockShowErrorMessage).toHaveBeenCalledWith('Test error', 'Show Logs');
      expect(mockShowWarningMessage).not.toHaveBeenCalled();
      expect(mockShowInformationMessage).not.toHaveBeenCalled();
    });

    it('should show warning message for warning severity', async () => {
      const error = new ExtensionError('Test warning', 'TEST_005', 'warning');
      mockShowWarningMessage.mockResolvedValue(undefined);

      await ErrorHandler.handleWithUserNotification(error, 'TestContext');

      expect(mockShowWarningMessage).toHaveBeenCalledWith('Test warning', 'Show Logs');
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('should show info message for info severity', async () => {
      const error = new ExtensionError('Test info', 'TEST_006', 'info');
      mockShowInformationMessage.mockResolvedValue(undefined);

      await ErrorHandler.handleWithUserNotification(error, 'TestContext');

      expect(mockShowInformationMessage).toHaveBeenCalledWith('Test info', 'Show Logs');
    });

    it('should use custom user message when provided', async () => {
      const error = new Error('Technical error');
      mockShowErrorMessage.mockResolvedValue(undefined);

      await ErrorHandler.handleWithUserNotification(
        error,
        'TestContext',
        'User-friendly error message'
      );

      expect(mockShowErrorMessage).toHaveBeenCalledWith('User-friendly error message', 'Show Logs');
    });
  });

  describe('wrapAsync', () => {
    it('should return result when function succeeds', async () => {
      const fn = () => Promise.resolve('success');
      const result = await ErrorHandler.wrapAsync(fn, 'TestContext');
      expect(result).toBe('success');
    });

    it('should return undefined when function throws', async () => {
      const fn = () => Promise.reject(new Error('Test error'));
      const result = await ErrorHandler.wrapAsync(fn, 'TestContext');
      expect(result).toBeUndefined();
    });
  });

  describe('wrapAsyncWithNotification', () => {
    it('should return result when function succeeds', async () => {
      const fn = () => Promise.resolve(42);
      mockShowErrorMessage.mockResolvedValue(undefined);

      const result = await ErrorHandler.wrapAsyncWithNotification(fn, 'TestContext');
      expect(result).toBe(42);
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('should show notification and return undefined when function throws', async () => {
      const fn = () => Promise.reject(new Error('Test error'));
      mockShowErrorMessage.mockResolvedValue(undefined);

      const result = await ErrorHandler.wrapAsyncWithNotification(fn, 'TestContext');
      expect(result).toBeUndefined();
      expect(mockShowErrorMessage).toHaveBeenCalled();
    });
  });

  describe('createError', () => {
    it('should create an ExtensionError', () => {
      const error = ErrorHandler.createError('Test message', 'TEST_007', 'warning');
      expect(error).toBeInstanceOf(ExtensionError);
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_007');
      expect(error.severity).toBe('warning');
    });
  });

  describe('isExtensionError', () => {
    it('should return true for ExtensionError', () => {
      const error = new ExtensionError('Test', 'TEST_008');
      expect(ErrorHandler.isExtensionError(error)).toBe(true);
    });

    it('should return false for standard Error', () => {
      const error = new Error('Test');
      expect(ErrorHandler.isExtensionError(error)).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(ErrorHandler.isExtensionError('string')).toBe(false);
      expect(ErrorHandler.isExtensionError(null)).toBe(false);
      expect(ErrorHandler.isExtensionError(undefined)).toBe(false);
    });
  });
});
