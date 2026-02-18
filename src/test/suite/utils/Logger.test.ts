jest.mock(
  "vscode",
  () => {
    const mockOutputChannel = {
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    };
    return {
      window: {
        createOutputChannel: jest.fn(() => mockOutputChannel),
      },
    };
  },
  { virtual: true },
);

import { Logger, LogLevel } from "../../../utils/Logger";
import * as vscode from "vscode";

// Get mock functions via the mocked API
const mockChannel = vscode.window.createOutputChannel("test") as any;
const mockAppendLine = mockChannel.appendLine;
const mockShow = mockChannel.show;

describe("Logger", () => {
  let logger: Logger;

  beforeEach(() => {
    // Restore the mock implementation because resetMocks: true wipes it
    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(
      mockChannel,
    );
    jest.clearAllMocks();
    Logger.initialize("Test Channel", LogLevel.DEBUG);
    logger = new Logger("TestContext");
  });

  afterEach(() => {
    Logger.dispose();
  });

  describe("debug", () => {
    it("should log debug messages when log level is DEBUG", () => {
      logger.debug("Test debug message");
      expect(mockAppendLine).toHaveBeenCalled();
      const logMessage = mockAppendLine.mock.calls[0][0] as string;
      expect(logMessage).toContain("[DEBUG]");
      expect(logMessage).toContain("[TestContext]");
      expect(logMessage).toContain("Test debug message");
    });

    it("should not log debug messages when log level is INFO", () => {
      Logger.setLogLevel(LogLevel.INFO);
      logger.debug("Test debug message");
      expect(mockAppendLine).not.toHaveBeenCalled();
    });
  });

  describe("info", () => {
    it("should log info messages", () => {
      logger.info("Test info message");
      expect(mockAppendLine).toHaveBeenCalled();
      const logMessage = mockAppendLine.mock.calls[0][0] as string;
      expect(logMessage).toContain("[INFO]");
      expect(logMessage).toContain("Test info message");
    });

    it("should log info messages with multiple arguments", () => {
      logger.info("Test message", { foo: "bar" }, 123);
      expect(mockAppendLine).toHaveBeenCalled();
      const logMessage = mockAppendLine.mock.calls[0][0] as string;
      expect(logMessage).toContain("Test message");
      expect(logMessage).toContain('"foo": "bar"');
      expect(logMessage).toContain("123");
    });
  });

  describe("warn", () => {
    it("should log warning messages", () => {
      logger.warn("Test warning");
      expect(mockAppendLine).toHaveBeenCalled();
      const logMessage = mockAppendLine.mock.calls[0][0] as string;
      expect(logMessage).toContain("[WARN]");
      expect(logMessage).toContain("Test warning");
    });
  });

  describe("error", () => {
    it("should log error messages", () => {
      logger.error("Test error");
      expect(mockAppendLine).toHaveBeenCalled();
      const logMessage = mockAppendLine.mock.calls[0][0] as string;
      expect(logMessage).toContain("[ERROR]");
      expect(logMessage).toContain("Test error");
    });

    it("should log error messages with Error objects", () => {
      const error = new Error("Something went wrong");
      logger.error("Test error", error);
      expect(mockAppendLine).toHaveBeenCalled();
      const logMessage = mockAppendLine.mock.calls[0][0] as string;
      expect(logMessage).toContain("Test error");
      expect(logMessage).toContain("Error: Something went wrong");
    });
  });

  describe("log level filtering", () => {
    it("should only log messages at or above the set log level", () => {
      Logger.setLogLevel(LogLevel.WARN);

      logger.debug("Debug message");
      expect(mockAppendLine).not.toHaveBeenCalled();

      logger.info("Info message");
      expect(mockAppendLine).not.toHaveBeenCalled();

      logger.warn("Warning message");
      expect(mockAppendLine).toHaveBeenCalledTimes(1);

      logger.error("Error message");
      expect(mockAppendLine).toHaveBeenCalledTimes(2);
    });
  });

  describe("show", () => {
    it("should show the output channel", () => {
      Logger.show();
      expect(mockShow).toHaveBeenCalled();
    });
  });
});
