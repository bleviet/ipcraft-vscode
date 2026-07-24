import { expect, test } from '@playwright/test';
import path from 'path';

const harnessPath = `file://${path.resolve(__dirname, 'data-inspector.html')}`;

const recipe = {
  version: 1,
  name: 'browser-canvas',
  description: '',
  sources: [
    { id: 'input', name: 'STATUS', width: 16 },
    { id: 'mask', name: 'MASK', width: 16 },
  ],
  fields: [],
  overlayGroups: [{ id: 'default', name: 'Default' }],
  steps: [
    { id: 'inverted', type: 'not', inputId: 'input' },
    { id: 'masked', type: 'and', inputId: 'input', operandId: 'mask' },
    { id: 'resultStep', type: 'shiftRight', inputId: 'masked', amount: 2 },
  ],
  view: {
    laneWidth: 16,
    zoom: 'bit',
    selectedGroupId: 'default',
  },
} as const;

test.describe('Data Inspector transform canvas', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(harnessPath);
    await page.waitForFunction(() =>
      (window as unknown as { __vscodeMessages: Array<{ type: string }> }).__vscodeMessages.some(
        (message) => message.type === 'ready'
      )
    );
    await page.evaluate((nextRecipe) => {
      (window as unknown as { renderRecipe: (value: unknown) => void }).renderRecipe(nextRecipe);
    }, recipe);
    await page.getByRole('textbox', { name: 'Literal' }).fill("16'h1234");
    await page.getByRole('button', { name: 'Decode' }).click();
    await expect(page.getByRole('heading', { name: 'Transform recipe' })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { __vscodeMessages: Array<{ type: string }> }
          ).__vscodeMessages.some((message) => message.type === 'updateRecipe')
        )
      )
      .toBe(true);
    await page.evaluate(() => {
      (window as unknown as { __vscodeMessages: unknown[] }).__vscodeMessages = [];
    });
  });

  test('renders the graph as the only workbench view', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Transform recipe' })).toBeVisible();
    await expect(page.locator('.di-flow-source')).toHaveCount(2);
    await expect(page.locator('.di-flow-step')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'List' })).toHaveCount(0);
    await expect(page.locator('.react-flow__controls')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  });

  test('keeps the minimap hidden until it is requested', async ({ page }) => {
    const minimap = page.locator('.react-flow__minimap');
    const showMinimap = page.getByRole('button', { name: 'Show minimap' });

    await expect(minimap).toHaveCount(0);
    await expect(showMinimap).toHaveAttribute('aria-pressed', 'false');
    await showMinimap.click();
    await expect(minimap).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide minimap' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('suppresses the native context menu across the Data Inspector', async ({ page }) => {
    const prevented = await page.locator('.di-shell').evaluate((element) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });

    expect(prevented).toBe(true);
  });

  test('shows reliable canvas button tooltips', async ({ page }) => {
    await page.getByRole('button', { name: 'Auto-layout' }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Arrange nodes left to right');

    await page.getByRole('button', { name: 'Zoom in' }).focus();
    await expect(page.getByRole('tooltip')).toHaveText('Zoom in');
  });

  test('uses the Library, split center workspace, and contextual Inspector layout', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const [library, bits, transform, inspector] = await Promise.all([
      page.getByLabel('Transform Library').boundingBox(),
      page.locator('.di-bits-pane').boundingBox(),
      page.locator('.di-transform-pane').boundingBox(),
      page.getByLabel('Inspector tools').boundingBox(),
    ]);

    expect(library).not.toBeNull();
    expect(bits).not.toBeNull();
    expect(transform).not.toBeNull();
    expect(inspector).not.toBeNull();
    expect(library!.x).toBeLessThan(bits!.x);
    expect(bits!.x).toBeLessThan(inspector!.x);
    expect(bits!.y).toBeLessThan(transform!.y);
    expect(bits!.width).toBeGreaterThan(500);
    expect(transform!.height).toBeGreaterThan(bits!.height);
  });

  test('preserves the maximized transform view when inputs and operators are added', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Maximize transform view' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const viewport = page.locator('.react-flow__viewport');
    const before = await viewport.getAttribute('style');

    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.locator('.di-flow-source')).toHaveCount(3);
    await expect(viewport).toHaveAttribute('style', before!);
    await expect(page.locator('.di-bits-pane')).toBeHidden();

    await page.getByRole('button', { name: 'Add NOT draft' }).click();
    await expect(page.locator('.di-flow-step.is-draft')).toHaveCount(1);
    await expect(viewport).toHaveAttribute('style', before!);
    await expect(page.locator('.di-bits-pane')).toBeHidden();
  });

  test('preserves the maximized bits view when inputs and operators are added', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Maximize bits view' }).click();
    await expect(page.locator('.di-transform-pane')).toBeHidden();

    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.locator('.di-flow-source')).toHaveCount(3);
    await expect(page.locator('.di-transform-pane')).toBeHidden();

    await page.getByRole('button', { name: 'Add NOT draft' }).click();
    await expect(page.locator('.di-flow-step.is-draft')).toHaveCount(1);
    await expect(page.locator('.di-transform-pane')).toBeHidden();
  });

  test('adds inputs from the Library and opens their Inspector', async ({ page }) => {
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.locator('.di-flow-source')).toHaveCount(3);
    await expect(page.getByLabel('Inspector tools').getByRole('heading')).toContainText('INPUT_3');
    await expect(page.getByLabel('INPUT_3 value')).toBeVisible();
  });

  test('gives a new input the width of the inputs already on the canvas', async ({ page }) => {
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.locator('.react-flow__node[data-id="input3"]')).toContainText('16b');
    await expect(page.getByLabel('Width', { exact: true })).toHaveValue('16');
  });

  test('keeps an unconnected operator when an input is added', async ({ page }) => {
    await page.getByRole('button', { name: 'Add NOT draft' }).click();
    await expect(page.locator('.di-flow-step.is-draft')).toHaveCount(1);

    await page.getByRole('button', { name: 'Add source' }).click();

    await expect(page.locator('.di-flow-source')).toHaveCount(3);
    await expect(page.locator('.di-flow-step.is-draft')).toHaveCount(1);
  });

  test('deletes selected components from the canvas toolbar', async ({ page }) => {
    const deleteButton = page.getByRole('button', { name: 'Delete selected components' });
    await expect(deleteButton).toBeDisabled();

    await page.getByRole('button', { name: 'Add source' }).click();
    await page.locator('.react-flow__node[data-id="input3"]').click();
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await expect(page.locator('.di-flow-source')).toHaveCount(2);

    const inverted = page.locator('.react-flow__node[data-id="inverted"]');
    await expect(inverted).toBeVisible();
    await inverted.click();
    await deleteButton.click();
    await expect(page.locator('.di-flow-step')).toHaveCount(2);
  });

  test('drags new inputs from the Library onto the canvas', async ({ page }) => {
    const canvas = page.locator('.react-flow__pane');
    await page.getByRole('button', { name: 'Add source' }).dragTo(canvas, {
      targetPosition: { x: 180, y: 220 },
    });
    await expect(page.locator('.di-flow-source')).toHaveCount(3);
  });

  test('assigns newly defined fields to the selected input', async ({ page }) => {
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.locator('.di-flow-source')).toHaveCount(3);
    await page.getByLabel('INPUT_3 value').fill("32'h000000F0");
    await page.getByRole('button', { name: 'Decode INPUT_3' }).click();
    await page.getByRole('tab', { name: 'Fields' }).click();
    await page.getByRole('button', { name: 'Add field' }).click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const updates = (
            window as unknown as {
              __vscodeMessages: Array<{
                type: string;
                recipe?: { fields: Array<{ sourceId: string }> };
              }>;
            }
          ).__vscodeMessages.filter((message) => message.type === 'updateRecipe');
          return updates.at(-1)?.recipe?.fields.at(-1)?.sourceId;
        })
      )
      .toBe('input3');
  });

  test('resizes and maximizes the center workspace while side rails collapse', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const initialWidth = (await page.locator('.di-center-workspace').boundingBox())!.width;

    const libraryDivider = page.getByRole('separator', {
      name: 'Resize Library and workspace',
    });
    await libraryDivider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(libraryDivider).toHaveAttribute('aria-valuenow', '250');

    const inspectorDivider = page.getByRole('separator', {
      name: 'Resize workspace and Inspector',
    });
    await inspectorDivider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(inspectorDivider).toHaveAttribute('aria-valuenow', '362');

    await page.getByRole('button', { name: 'Collapse Library' }).click();
    await expect(page.getByRole('button', { name: 'Expand Library' })).toBeVisible();
    const libraryCollapsedWidth = (await page.locator('.di-center-workspace').boundingBox())!.width;
    expect(libraryCollapsedWidth).toBeGreaterThan(initialWidth);

    await page.getByRole('button', { name: 'Collapse Inspector' }).click();
    await expect(page.getByRole('button', { name: 'Expand Inspector' })).toBeVisible();
    const bothCollapsedWidth = (await page.locator('.di-center-workspace').boundingBox())!.width;
    expect(bothCollapsedWidth).toBeGreaterThan(libraryCollapsedWidth);

    const divider = page.getByRole('separator', { name: 'Resize bits and transform views' });
    await divider.focus();
    await page.keyboard.press('ArrowDown');
    await expect(divider).toHaveAttribute('aria-valuenow', '46');

    await page.getByRole('button', { name: 'Maximize transform view' }).click();
    await expect(page.locator('.di-bits-pane')).toBeHidden();
    await page.getByRole('button', { name: 'Restore split view' }).click();
    await expect(page.locator('.di-bits-pane')).toBeVisible();
  });

  test('selects a graph input for value and field editing', async ({ page }) => {
    await page.locator('.react-flow__node[data-id="mask"]').click();
    await expect(page.getByLabel('Inspector tools').getByRole('heading')).toContainText('MASK');
    await expect(page.locator('.di-bits .is-source-highlighted')).toHaveCount(0);
    await expect(page.locator('.di-bits .is-source-dimmed')).toHaveCount(0);
    await page.getByLabel('MASK value').fill("16'h00FF");
    await page.getByRole('button', { name: 'Decode MASK' }).click();
    await expect(page.getByLabel('Inspector tools').locator('.di-inspector-value')).toHaveText(
      '0x00FF'
    );
    await page.getByRole('tab', { name: 'Fields' }).click();
    await expect(page.getByRole('button', { name: 'Add field' })).toBeVisible();
    await expect(page.getByText('Import register layout')).toBeVisible();
  });

  test('rewires a step output into a binary input', async ({ page }) => {
    const source = page.locator('.react-flow__node[data-id="inverted"] .react-flow__handle-right');
    const target = page.locator(
      '.react-flow__node[data-id="masked"] .react-flow__handle[data-handleid="operand"]'
    );
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();
    await source.dragTo(target, { force: true });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const update = (
            window as unknown as {
              __vscodeMessages: Array<{
                type: string;
                recipe?: { steps: Array<{ id: string; operandId?: string }> };
              }>;
            }
          ).__vscodeMessages.find((message) => message.type === 'updateRecipe');
          return update?.recipe?.steps.find((step) => step.id === 'masked')?.operandId;
        })
      )
      .toBe('inverted');
    const updateCount = await page.evaluate(
      () =>
        (
          window as unknown as { __vscodeMessages: Array<{ type: string }> }
        ).__vscodeMessages.filter((message) => message.type === 'updateRecipe').length
    );
    expect(updateCount).toBe(1);
  });

  test('topologically reorders dependencies changed through the Inspector', async ({ page }) => {
    await page.locator('.react-flow__node[data-id="inverted"]').click();
    await page.getByLabel('Primary input').selectOption('masked');

    await expect
      .poll(() =>
        page.evaluate(() => {
          const update = (
            window as unknown as {
              __vscodeMessages: Array<{
                type: string;
                recipe?: { steps: Array<{ id: string; inputId: string }> };
              }>;
            }
          ).__vscodeMessages.find((message) => message.type === 'updateRecipe');
          const steps = update?.recipe?.steps;
          if (!steps) {
            return null;
          }
          return {
            inputId: steps.find((step) => step.id === 'inverted')?.inputId,
            maskedIndex: steps.findIndex((step) => step.id === 'masked'),
            invertedIndex: steps.findIndex((step) => step.id === 'inverted'),
          };
        })
      )
      .toEqual({ inputId: 'masked', maskedIndex: 0, invertedIndex: 1 });
    await expect(page.getByRole('button', { name: 'Problems 0' })).toBeVisible();
  });

  test('shows a width error without sending the invalid recipe', async ({ page }) => {
    await page.evaluate(
      (invalidRecipe) => {
        (window as unknown as { __vscodeMessages: unknown[] }).__vscodeMessages = [];
        (
          window as unknown as { renderRecipe: (value: unknown, version: number) => void }
        ).renderRecipe(invalidRecipe, 2);
      },
      {
        ...recipe,
        sources: [recipe.sources[0], { ...recipe.sources[1], width: 8 }],
      }
    );

    await expect(
      page.locator('.react-flow__node[data-id="masked"] .di-flow-step.is-error')
    ).toContainText('operands must have equal widths');
    await expect(page.locator('.react-flow__edge.is-error')).toHaveCount(1);
    await expect(page.getByRole('status')).toHaveText('Not saved — 1 problem');
    await expect(page.getByRole('button', { name: 'Save recipe…' })).toBeDisabled();
    await page.waitForTimeout(180);
    const updateCount = await page.evaluate(
      () =>
        (
          window as unknown as { __vscodeMessages: Array<{ type: string }> }
        ).__vscodeMessages.filter((message) => message.type === 'updateRecipe').length
    );
    expect(updateCount).toBe(0);
  });

  test('ignores its own recipe echo without reverting a newer local edit', async ({ page }) => {
    const sourceNode = page.locator('.react-flow__node[data-id="input"]');
    await sourceNode.dispatchEvent('click');
    const sourceName = page.getByLabel('Source 1 name');
    await expect(sourceName).toBeVisible();
    await sourceName.fill('STATUS_RENAMED');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const update = (
            window as unknown as {
              __vscodeMessages: Array<{ type: string; editId?: number }>;
            }
          ).__vscodeMessages.find((message) => message.type === 'updateRecipe');
          return update?.editId;
        })
      )
      .toBeTruthy();
    const editId = await page.evaluate(() => {
      const update = (
        window as unknown as {
          __vscodeMessages: Array<{ type: string; editId?: number }>;
        }
      ).__vscodeMessages.find((message) => message.type === 'updateRecipe');
      return update!.editId!;
    });
    await page.locator('.react-flow__node[data-id="masked"]').click();

    await page.evaluate(
      ({ staleRecipe, sourceEditId }) => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'recipe',
              recipe: staleRecipe,
              fileName: 'browser.ipci.yml',
              docVersion: 2,
              sourceEditId,
            },
          })
        );
      },
      { staleRecipe: recipe, sourceEditId: editId }
    );

    await expect(page.getByLabel('Inspector tools').getByRole('heading')).toHaveText('masked');
    await sourceNode.dispatchEvent('click');
    await expect(sourceName).toHaveValue('STATUS_RENAMED');
  });

  test('wires an operation in one recipe update and saves its canvas position', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Add Byte swap draft' }).click();
    const source = page.locator('.react-flow__node[data-id="mask"] .react-flow__handle-right');
    const target = page.locator(
      '.di-flow-step.is-draft .react-flow__handle[data-handleid="input"]'
    );
    await expect(target).toBeVisible();
    const fitCanvas = page.getByRole('button', { name: 'Fit canvas' });
    await expect
      .poll(
        async () => {
          const endpointsInView = await Promise.all(
            [source, target].map((endpoint) =>
              endpoint.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                return (
                  bounds.width > 0 &&
                  bounds.height > 0 &&
                  bounds.left >= 0 &&
                  bounds.top >= 0 &&
                  bounds.right <= window.innerWidth &&
                  bounds.bottom <= window.innerHeight
                );
              })
            )
          );
          if (!endpointsInView.every(Boolean)) {
            await fitCanvas.click();
          }
          return endpointsInView.every(Boolean);
        },
        { intervals: [250], timeout: 5000 }
      )
      .toBe(true);
    const [sourceBounds, targetBounds] = await Promise.all([
      source.boundingBox(),
      target.boundingBox(),
    ]);
    expect(sourceBounds).not.toBeNull();
    expect(targetBounds).not.toBeNull();
    await page.mouse.move(
      sourceBounds!.x + sourceBounds!.width / 2,
      sourceBounds!.y + sourceBounds!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBounds!.x + targetBounds!.width / 2,
      targetBounds!.y + targetBounds!.height / 2,
      { steps: 12 }
    );
    await page.mouse.up();

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __vscodeMessages: Array<{ type: string; recipe?: { steps: unknown[] } }>;
              }
            ).__vscodeMessages.filter((message) => message.type === 'updateRecipe').length
        )
      )
      .toBe(1);
    const update = await page.evaluate(() =>
      (
        window as unknown as {
          __vscodeMessages: Array<{
            type: string;
            recipe?: {
              steps: Array<{ id: string }>;
              view: { canvas?: { nodes: Array<{ id: string; x: number; y: number }> } };
            };
          }>;
        }
      ).__vscodeMessages.find(
        (message) => message.type === 'updateRecipe' && message.recipe?.steps.length === 4
      )
    );
    expect(update?.recipe?.steps).toHaveLength(4);
    expect(update?.recipe?.view.canvas?.nodes.length).toBeGreaterThanOrEqual(6);

    const addedId = update?.recipe?.steps.at(-1)?.id;
    const savedPosition = update?.recipe?.view.canvas?.nodes.find(
      (position) => position.id === addedId
    );
    expect(addedId).toBeTruthy();
    expect(savedPosition).toBeTruthy();
    await page.evaluate((savedRecipe) => {
      (
        window as unknown as { renderRecipe: (value: unknown, version: number) => void }
      ).renderRecipe(savedRecipe, 2);
    }, update?.recipe);
    const transform = await page
      .locator(`.react-flow__node[data-id="${addedId}"]`)
      .evaluate((node) => (node as HTMLElement).style.transform);
    expect(transform).toContain(`${savedPosition!.x}px`);
    expect(transform).toContain(`${savedPosition!.y}px`);
  });

  test('keeps a newly wired operation while its source widths are invalid', async ({ page }) => {
    // The Inspector derives these from the current counts, so track the fixture rather
    // than hardcoding IDs that silently drift when the recipe above gains a node.
    const mismatchedSourceId = `input${recipe.sources.length + 1}`;
    const mismatchedSourceName = `INPUT_${recipe.sources.length + 1}`;
    const invalidStateSourceId = `input${recipe.sources.length + 2}`;
    const wiredStepId = `step${recipe.steps.length + 1}`;
    const inspectorHeading = page.getByLabel('Inspector tools').getByRole('heading');

    await page.setViewportSize({ width: 1440, height: 900 });
    // Adding a source selects it. Wait for the Inspector to follow before editing, then
    // widen it past the 16-bit sources it will be wired against to force the invalid state.
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(inspectorHeading).toContainText(mismatchedSourceName);
    await page.getByLabel('Width', { exact: true }).fill('32');
    await page.getByRole('button', { name: 'Add XOR draft' }).click();
    await page.getByRole('button', { name: 'Fit canvas' }).click();

    const draft = page.locator('.react-flow__node:has(.di-flow-step.is-draft)');
    const connections = [
      [
        page.locator('.react-flow__node[data-id="input"] .react-flow__handle-right'),
        draft.locator('.react-flow__handle[data-handleid="input"]'),
      ],
      [
        page.locator(
          `.react-flow__node[data-id="${mismatchedSourceId}"] .react-flow__handle-right`
        ),
        draft.locator('.react-flow__handle[data-handleid="operand"]'),
      ],
    ] as const;
    for (const [source, target] of connections) {
      const [sourceBounds, targetBounds] = await Promise.all([
        source.boundingBox(),
        target.boundingBox(),
      ]);
      expect(sourceBounds).not.toBeNull();
      expect(targetBounds).not.toBeNull();
      await page.mouse.move(
        sourceBounds!.x + sourceBounds!.width / 2,
        sourceBounds!.y + sourceBounds!.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(
        targetBounds!.x + targetBounds!.width / 2,
        targetBounds!.y + targetBounds!.height / 2,
        { steps: 12 }
      );
      await page.mouse.up();
    }

    const addedStep = page.locator(`.react-flow__node[data-id="${wiredStepId}"]`);
    await expect(addedStep.locator('.di-flow-step.is-error')).toContainText(
      'operands must have equal widths'
    );
    await expect(page.getByRole('button', { name: 'Problems 1' })).toBeVisible();

    // The invalid state is allowed to exist only because it cannot be saved.
    await page.evaluate(() => {
      (window as unknown as { __vscodeMessages: unknown[] }).__vscodeMessages = [];
    });
    await page.getByRole('button', { name: 'Add source' }).click();
    const addedWhileInvalid = page.locator(`.react-flow__node[data-id="${invalidStateSourceId}"]`);
    await expect(addedWhileInvalid).toBeVisible();
    await expect(page.getByRole('button', { name: 'Problems 1' })).toBeVisible();
    await page.waitForTimeout(400); // past the autosave debounce
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as { __vscodeMessages: Array<{ type: string }> }
          ).__vscodeMessages.filter((message) => message.type === 'updateRecipe').length
      )
    ).toBe(0);

    // The source node sits under the operation it feeds, so dispatch the click directly
    // instead of routing it through a pointer that the overlapping node would swallow.
    await page.locator(`.react-flow__node[data-id="${mismatchedSourceId}"]`).dispatchEvent('click');
    await expect(inspectorHeading).toContainText(mismatchedSourceName);
    await page.getByLabel('Width', { exact: true }).fill('16');

    await expect(addedStep).toBeVisible();
    await expect(addedWhileInvalid).toBeVisible();
    await expect(addedStep.locator('.di-flow-step.is-error')).toHaveCount(0);
    await expect(addedStep).toContainText('16b');
    await expect(page.getByRole('button', { name: 'Problems 0' })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          ({ sourceId, stepId }) => {
            const updates = (
              window as unknown as {
                __vscodeMessages: Array<{
                  type: string;
                  recipe?: {
                    sources: Array<{ id: string }>;
                    steps: Array<{ id: string }>;
                  };
                }>;
              }
            ).__vscodeMessages.filter((message) => message.type === 'updateRecipe');
            const savedRecipe = updates.at(-1)?.recipe;
            return {
              source: savedRecipe?.sources.some((source) => source.id === sourceId),
              step: savedRecipe?.steps.some((step) => step.id === stepId),
            };
          },
          { sourceId: invalidStateSourceId, stepId: wiredStepId }
        )
      )
      .toEqual({ source: true, step: true });
  });

  test('creates a draft with the keyboard and clears it after a recipe error', async ({ page }) => {
    const addNot = page.getByRole('button', { name: 'Add NOT draft' });
    await addNot.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.di-flow-step.is-draft')).toHaveCount(1);

    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'recipeError', error: 'The recipe changed outside the canvas' },
        })
      );
    });
    await expect(page.locator('.di-flow-step.is-draft')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText('Not saved — 1 problem');
    await expect(page.getByRole('button', { name: 'Save recipe…' })).toBeDisabled();
    const updateCount = await page.evaluate(
      () =>
        (
          window as unknown as { __vscodeMessages: Array<{ type: string }> }
        ).__vscodeMessages.filter((message) => message.type === 'updateRecipe').length
    );
    expect(updateCount).toBe(0);
  });

  test('keeps an unconnected operation visible when it is moved', async ({ page }) => {
    await page.getByRole('button', { name: 'Add NOT draft' }).click();
    const draft = page.locator('.react-flow__node:has(.di-flow-step.is-draft)');
    await expect(draft).toHaveCount(1);
    await draft.hover({ position: { x: 20, y: 20 } });
    const before = await draft.boundingBox();
    expect(before).not.toBeNull();

    await page.evaluate(() => {
      (window as unknown as { __vscodeMessages: unknown[] }).__vscodeMessages = [];
    });
    await page.mouse.down();
    await page.mouse.move(before!.x + 140, before!.y + 100, {
      steps: 8,
    });
    await page.mouse.up();

    await expect(draft).toHaveCount(1);
    const after = await draft.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.x).toBeGreaterThan(before!.x + 80);
    const updateCount = await page.evaluate(
      () =>
        (
          window as unknown as { __vscodeMessages: Array<{ type: string }> }
        ).__vscodeMessages.filter((message) => message.type === 'updateRecipe').length
    );
    expect(updateCount).toBe(0);
  });
});
