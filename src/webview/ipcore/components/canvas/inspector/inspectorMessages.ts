import type {
  IpCoreHostMessage,
  IpCoreWebviewMessage,
} from '../../../../../shared/messages/ipCore';
import { vscode } from '../../../../vscode';
import type { ConduitPort } from '../../../../types/ipCore';

type MessageOfType<Message extends { type: string }, Type extends Message['type']> = Extract<
  Message,
  { type: Type }
>;

export function buildCheckFilesExistMessage(paths: string[]): IpCoreWebviewMessage {
  return { type: 'checkFilesExist', paths };
}

export function buildOpenFileMessage(path: string): IpCoreWebviewMessage {
  return { type: 'openFile', path };
}

export function buildSelectFilesMessage(options: {
  startPath?: string;
  multi?: boolean;
  filters?: Record<string, string[]>;
}): IpCoreWebviewMessage {
  return { type: 'selectFiles', ...options };
}

export function buildAddSubcoreMessage(): IpCoreWebviewMessage {
  return { type: 'addSubcore' };
}

export function buildSaveCustomBusDefinitionMessage(
  typeName: string,
  ports: ConduitPort[],
  parameters: Array<{ name: string; value?: unknown; defaultValue?: unknown }>
): IpCoreWebviewMessage {
  const normalizedTypeName = typeName || 'custom';
  const displayName = normalizedTypeName.charAt(0).toUpperCase() + normalizedTypeName.slice(1);
  const defaults = Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.defaultValue ?? parameter.value ?? 1])
  );

  return {
    type: 'saveCustomBusDefinition',
    typeName: normalizedTypeName,
    displayName,
    ports: ports.map((port) => {
      const isParameterReference = typeof port.width === 'string' && isNaN(Number(port.width));
      return {
        name: port.name,
        direction: port.direction,
        defaultWidth: isParameterReference ? (defaults[port.width as string] ?? 1) : port.width,
        width: port.width,
        presence: port.presence ?? 'required',
      };
    }),
  };
}

export function sendInspectorMessage(message: IpCoreWebviewMessage): void {
  vscode?.postMessage(message);
}

export function listenForInspectorHostMessage<Type extends IpCoreHostMessage['type']>(
  type: Type,
  onMessage: (message: MessageOfType<IpCoreHostMessage, Type>) => void
): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    const message = event.data as Partial<IpCoreHostMessage>;
    if (message.type !== type) {
      return;
    }
    window.removeEventListener('message', listener);
    onMessage(message as MessageOfType<IpCoreHostMessage, Type>);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
