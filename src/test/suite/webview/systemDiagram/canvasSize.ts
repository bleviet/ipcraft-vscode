/**
 * jsdom lays nothing out, so React Flow takes a 500x500 canvas and, with onlyRenderVisibleElements,
 * culls the nodes outside it. Gives every element a large size for the tests that read the nodes.
 */
export function stubCanvasSize(size = 20000): void {
  const stubs: Array<[string, PropertyDescriptor | undefined]> = [];
  beforeAll(() => {
    for (const name of ['offsetWidth', 'offsetHeight']) {
      stubs.push([name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: size });
    }
  });
  afterAll(() => {
    for (const [name, descriptor] of stubs) {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, name, descriptor);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      }
    }
    stubs.length = 0;
  });
}
