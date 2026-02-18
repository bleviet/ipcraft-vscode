import { useEffect } from "react";

/**
 * VSCode API wrapper type
 */
interface VsCodeApi {
  postMessage: (message: any) => void;
}

/**
 * Message from the extension host
 */
interface ExtensionMessage {
  type: string;
  text?: string;
  fileName?: string;
  [key: string]: any;
}

/**
 * Hook for synchronizing with VSCode extension via message passing
 */
export function useYamlSync(
  vscode: VsCodeApi | undefined,
  onUpdate: (text: string, fileName?: string) => void,
) {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "update":
          if (message.text !== undefined) {
            onUpdate(message.text, message.fileName);
          }
          break;
        default:
        // Ignore unknown message types
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [onUpdate]);

  /**
   * Send updated YAML text to the extension
   */
  const sendUpdate = (text: string) => {
    vscode?.postMessage({ type: "update", text });
  };

  /**
   * Send a command to the extension
   */
  const sendCommand = (command: string, payload?: any) => {
    vscode?.postMessage({ type: "command", command, ...payload });
  };

  return {
    sendUpdate,
    sendCommand,
  };
}
