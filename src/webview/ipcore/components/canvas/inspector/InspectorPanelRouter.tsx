import React from 'react';
import type { BusInterface, Clock, Interrupt, IpCore, Port, Reset } from '../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../types/editor';
import type { CanvasElement } from '../../../hooks/useCanvasSelection';
import type { BatchUpdate } from '../../../hooks/useGroupPorts';
import { BodyPanel, SubcorePanel } from './body/BodyPanel';
import { BusInterfaceMatrixPanel } from './buses/BusInterfaceMatrixPanel';
import { BusPanel } from './buses/BusPanel';
import { EmptyState } from './controls/InspectorFields';
import { GenericsOverviewPanel } from './parameters/GenericsOverviewPanel';
import { ParameterPanel } from './parameters/ParameterPanel';
import { ClockPanel, InterruptPanel, PortPanel, ResetPanel } from './signals/SignalPanels';

interface InspectorPanelRouterProps {
  element: CanvasElement;
  ipCore: IpCore;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
  batchUpdate?: BatchUpdate;
  onSelectElement?: (id: string) => void;
}

export const InspectorPanelRouter: React.FC<InspectorPanelRouterProps> = ({
  element,
  ipCore,
  imports,
  onUpdate,
  batchUpdate,
  onSelectElement,
}) => {
  switch (element.kind) {
    case 'body':
      return <BodyPanel ipCore={ipCore} onUpdate={onUpdate} />;
    case 'generics':
      return (
        <GenericsOverviewPanel
          ipCore={ipCore}
          onUpdate={onUpdate}
          batchUpdate={batchUpdate}
          onSelectElement={onSelectElement}
        />
      );
    case 'busInterfaceMatrix':
      return (
        <BusInterfaceMatrixPanel
          ipCore={ipCore}
          onUpdate={onUpdate}
          onSelectElement={onSelectElement}
        />
      );
    case 'clock': {
      const clock = (ipCore.clocks ?? [])[element.index] as Clock | undefined;
      return clock ? (
        <ClockPanel clock={clock} index={element.index} ipCore={ipCore} onUpdate={onUpdate} />
      ) : (
        <EmptyState label="Clock not found" />
      );
    }
    case 'reset': {
      const reset = (ipCore.resets ?? [])[element.index] as Reset | undefined;
      return reset ? (
        <ResetPanel reset={reset} index={element.index} ipCore={ipCore} onUpdate={onUpdate} />
      ) : (
        <EmptyState label="Reset not found" />
      );
    }
    case 'port': {
      const port = (ipCore.ports ?? [])[element.index] as Port | undefined;
      return port ? (
        <PortPanel
          port={port}
          index={element.index}
          ipCore={ipCore}
          onUpdate={onUpdate}
          batchUpdate={batchUpdate}
        />
      ) : (
        <EmptyState label="Port not found" />
      );
    }
    case 'busInterface': {
      const bus = (ipCore.busInterfaces ?? [])[element.index] as BusInterface | undefined;
      return bus ? (
        <BusPanel
          key={element.index}
          bus={bus}
          index={element.index}
          ipCore={ipCore}
          imports={imports}
          onUpdate={onUpdate}
        />
      ) : (
        <EmptyState label="Bus interface not found" />
      );
    }
    case 'parameter': {
      const param = (ipCore.parameters ?? [])[element.index] as unknown as
        | Record<string, unknown>
        | undefined;
      return param ? (
        <ParameterPanel
          param={param}
          index={element.index}
          ipCore={ipCore}
          onUpdate={onUpdate}
          batchUpdate={batchUpdate}
        />
      ) : (
        <EmptyState label="Parameter not found" />
      );
    }
    case 'interrupt': {
      const interrupt = ((ipCore.interrupts ?? []) as Interrupt[])[element.index];
      return interrupt ? (
        <InterruptPanel
          interrupt={interrupt}
          index={element.index}
          ipCore={ipCore}
          onUpdate={onUpdate}
        />
      ) : (
        <EmptyState label="Interrupt not found" />
      );
    }
    case 'subcore': {
      const subcores = (ipCore.subcores ?? []) as Array<string | { vlnv: string; path?: string }>;
      const entry = subcores[element.index];
      return entry === undefined ? (
        <EmptyState label="Dependency not found" />
      ) : (
        <SubcorePanel entry={entry} index={element.index} ipCore={ipCore} onUpdate={onUpdate} />
      );
    }
    default:
      return <EmptyState label="Select a port on the canvas to inspect it" />;
  }
};
