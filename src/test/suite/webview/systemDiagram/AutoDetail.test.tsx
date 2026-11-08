import React, { Profiler, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { AutoDetail } from '../../../../webview/systemDiagram/AutoDetail';

// Real @xyflow/react store: the far selector re-renders only across the threshold, and the
// imperative subscription is released whenever the effect re-runs or the component goes.
let store: ReturnType<typeof useStoreApi>;
let subscriptions = 0;
let commits = 0;

// Counts the live store subscriptions; everything else is the real store.
jest.mock('@xyflow/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('@xyflow/react')>('@xyflow/react');
  return {
    ...actual,
    useStoreApi: () => {
      const api = actual.useStoreApi();
      return React.useMemo(
        () => ({
          ...api,
          subscribe: (listener: Parameters<typeof api.subscribe>[0]) => {
            subscriptions += 1;
            const release = api.subscribe(listener);
            return () => {
              subscriptions -= 1;
              release();
            };
          },
        }),
        [api]
      );
    },
  };
});

function Probe() {
  store = useStoreApi();
  return null;
}

function Harness({ enabled }: { enabled: boolean }) {
  const target = useRef<HTMLDivElement>(null);
  return (
    <ReactFlowProvider>
      <Probe />
      <div ref={target} data-testid="canvas" />
      <Profiler id="auto" onRender={() => (commits += 1)}>
        <AutoDetail target={target} enabled={enabled} />
      </Profiler>
    </ReactFlowProvider>
  );
}

const zoomTo = (zoom: number) => act(() => store.setState({ transform: [0, 0, zoom] }));
const canvas = () => document.querySelector('[data-testid=canvas]') as HTMLElement;

beforeEach(() => {
  subscriptions = 0;
  commits = 0;
});

it('re-renders only when the zoom crosses the far threshold', () => {
  render(<Harness enabled />);
  const mounted = commits;
  zoomTo(0.9);
  zoomTo(0.6);
  zoomTo(0.43);
  expect(commits).toBe(mounted);
  expect(canvas().style.getPropertyValue('--sd-name-scale')).toBe('');
  zoomTo(0.41);
  expect(commits).toBe(mounted + 1);
  zoomTo(0.2);
  zoomTo(0.1);
  expect(commits).toBe(mounted + 1);
  expect(canvas().style.getPropertyValue('--sd-name-scale')).toBe('3');
  zoomTo(0.8);
  expect(commits).toBe(mounted + 2);
  expect(canvas().dataset.far).toBe('false');
  expect(canvas().style.getPropertyValue('--sd-name-scale')).toBe('');
});

it('writes the name scale only when its quantized value changes', () => {
  render(<Harness enabled />);
  const element = canvas();
  const setProperty = jest.spyOn(element.style, 'setProperty');
  zoomTo(0.41);
  expect(setProperty).toHaveBeenCalledTimes(1);
  expect(setProperty).toHaveBeenLastCalledWith('--sd-name-scale', '2.5');
  zoomTo(0.405);
  zoomTo(0.4);
  expect(setProperty).toHaveBeenCalledTimes(1);
  zoomTo(0.36);
  expect(setProperty).toHaveBeenCalledTimes(2);
  expect(setProperty).toHaveBeenLastCalledWith('--sd-name-scale', '2.75');
});

it('holds one subscription: released when switched off or unmounted, not leaked on re-runs', () => {
  const { rerender, unmount } = render(<Harness enabled />);
  expect(subscriptions).toBe(1);
  zoomTo(0.3);
  expect(subscriptions).toBe(1);
  rerender(<Harness enabled={false} />);
  expect(subscriptions).toBe(0);
  expect(canvas().hasAttribute('data-far')).toBe(false);
  expect(canvas().style.getPropertyValue('--sd-name-scale')).toBe('');
  rerender(<Harness enabled />);
  expect(subscriptions).toBe(1);
  unmount();
  expect(subscriptions).toBe(0);
});
