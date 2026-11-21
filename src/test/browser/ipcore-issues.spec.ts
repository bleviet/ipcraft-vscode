import { test, expect } from '@playwright/test';
import path from 'path';
import { builtinBusLibrary } from '../helpers/busLibrary';

test.describe('IP core Issues workflow', () => {
  const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;
  const invalidYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: invalid_axis
  version: 1.0.0
busInterfaces:
  - name: M_AXIS
    type: ipcraft:busif:axi_stream:1.0
    mode: master
    physicalPrefix: m_axis_
    useOptionalPorts: [TKEEP]
    portWidthOverrides:
      TDATA: 32
      TKEEP: 5
`;

  test.beforeEach(async ({ page }) => {
    const readyPromise = page.waitForEvent('console', {
      predicate: (message) =>
        message.text().includes('VSCODE_MESSAGE:') && message.text().includes('"ready"'),
      timeout: 10000,
    });
    await page.goto(harnessPath);
    await page.waitForSelector('#ipcore-root');
    await readyPromise;
    await page.evaluate(
      ({ text, library }) => {
        window.postMessage(
          {
            type: 'update',
            text,
            fileName: 'invalid_axis.ip.yml',
            imports: { busLibrary: library },
          },
          '*'
        );
      },
      { text: invalidYaml, library: builtinBusLibrary() }
    );
    await expect(page.getByRole('button', { name: /\d+ errors, \d+ warnings/ })).toBeVisible();
  });

  test('marks the bundle and subport, focuses the issue, and surfaces blocked generation', async ({
    page,
  }) => {
    const issueCount = page.getByRole('button', { name: /\d+ errors, \d+ warnings/ });
    await expect(issueCount).toHaveAccessibleName('2 errors, 0 warnings');
    await issueCount.click();

    const issuesPanel = page.getByRole('complementary', { name: 'Issues' });
    await expect(issuesPanel).toBeVisible();
    await expect(page.getByText('Protocol', { exact: true })).toBeVisible();
    const issueRow = issuesPanel.getByRole('button', {
      name: /TKEEP must match its derived contract width/,
    });
    await expect(issueRow).toBeVisible();

    const bundle = page.locator('[data-port-id="bus:0"]');
    await expect(bundle.locator('.ip-canvas-annotation-dot--error')).toBeVisible();
    const subport = page.locator('.canvas-bus-subport', { hasText: /TKEEP/ });
    await expect(subport.locator('.ip-canvas-annotation-dot--error')).toBeVisible();

    await issueRow.click();
    await expect(bundle).toHaveClass(/selected/);
    await expect(page.locator('#bus-0-width-TKEEP')).toBeFocused();

    await page
      .getByRole('button', {
        name: 'Scaffold Project (RTL + EDA packaging + Testbench)',
      })
      .click();
    await page.evaluate(() => {
      window.postMessage(
        {
          type: 'generateResult',
          success: false,
          issues: [
            {
              code: 'BUS_DERIVED_WIDTH_OVERRIDE',
              severity: 'error',
              source: 'protocol',
              path: ['busInterfaces', 0, 'portWidthOverrides', 'TKEEP'],
              interfaceName: 'M_AXIS',
              message: 'TKEEP must match its derived contract width.',
            },
          ],
        },
        '*'
      );
    });
    const blockedPanel = page.getByRole('complementary', { name: 'Issues' });
    await expect(blockedPanel).toBeVisible();
    await expect(
      blockedPanel.getByRole('button', { name: /TKEEP must match its derived contract width/ })
    ).toBeVisible();
  });

  test.describe('consistency results', () => {
    const hdlIssueMessage = "Port 'led' is 8 bits in the spec and 4 in the HDL.";
    const consistencyResult = {
      type: 'consistencyResult',
      findings: [
        {
          kind: 'width-mismatch',
          message: hdlIssueMessage,
          ipYmlPath: ['ports', 0],
          hdlFile: 'rtl/core.sv',
          hdlEntity: 'core',
          severity: 'amber',
          source: 'hdl',
        },
      ],
      issues: [
        {
          code: 'CONSISTENCY_WIDTH_MISMATCH',
          severity: 'warning',
          source: 'hdl',
          path: ['ports', 0],
          message: hdlIssueMessage,
        },
      ],
      summary: { added: 1, removed: 0, changed: 0 },
    };

    test('a manual check that finds something opens the Issues panel', async ({ page }) => {
      await page.evaluate((message) => window.postMessage(message, '*'), consistencyResult);

      const issuesPanel = page.getByRole('complementary', { name: 'Issues' });
      await expect(issuesPanel).toBeVisible();
      await expect(issuesPanel.getByRole('button', { name: hdlIssueMessage })).toBeVisible();
    });

    test('a long finding wraps inside an Issues panel that has the inspector width', async ({
      page,
    }) => {
      const longMessage =
        "'o_status' exists in led_controller_avmm.vhd (entity/module 'led_controller_avmm') but is not declared in the .ip.yml.";
      await page.evaluate(
        ({ result, text }) =>
          window.postMessage({ ...result, issues: [{ ...result.issues[0], message: text }] }, '*'),
        { result: consistencyResult, text: longMessage }
      );

      const issuesPanel = page.getByRole('complementary', { name: 'Issues' });
      await expect(issuesPanel).toBeVisible();
      const box = await issuesPanel.boundingBox();
      expect(box?.width).toBeCloseTo(288, 0);

      // The message is a flex item (one box), so count the line boxes of its text instead.
      const lines = await issuesPanel.getByText(longMessage).evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      });
      expect(lines).toBeGreaterThan(1);
    });

    test('a background check lists its findings without opening the Issues panel', async ({
      page,
    }) => {
      await page.evaluate(
        (message) => window.postMessage({ ...message, auto: true }, '*'),
        consistencyResult
      );

      await expect(
        page.getByRole('button', { name: /\d+ errors, \d+ warnings/ })
      ).toHaveAccessibleName('2 errors, 1 warnings');
      await expect(page.getByRole('complementary', { name: 'Issues' })).toBeHidden();
    });
  });

  test('keeps preview save enabled while surfacing an unresolved bus warning', async ({ page }) => {
    const unresolvedYaml = `
vlnv:
  vendor: test.com
  library: smoke
  name: imported_stream
  version: 1.0.0
busInterfaces:
  - name: stream
    type: acme.com:bus:future_stream:1.0
    mode: source
    physicalPrefix: stream_
`;
    await page.evaluate(
      ({ text, library }) => {
        window.postMessage(
          {
            type: 'update',
            text,
            fileName: 'future_stream_hw.tcl',
            isPreview: true,
            imports: { busLibrary: library },
          },
          '*'
        );
      },
      { text: unresolvedYaml, library: builtinBusLibrary() }
    );

    await expect(page.getByRole('button', { name: '0 errors, 1 warning' })).toBeVisible();
    const save = page.getByRole('button', { name: 'Save as .ip.yml' });
    await expect(save).toBeEnabled();
    await expect(save).toHaveAttribute('title', /Save with unresolved bus warnings/);
    // The debounced echo of the loaded YAML (150 ms) can be posted after the
    // click, so check every posted message rather than only the last one.
    await page.evaluate(() => {
      const posted: unknown[] = [];
      Reflect.set(window, '__posted_types', posted);
      window.addEventListener('vscode-post-message', (event: Event) => {
        if (event instanceof CustomEvent) {
          posted.push((event.detail as { type?: unknown } | null)?.type);
        }
      });
    });
    await save.click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, '__posted_types') as unknown[]))
      .toContain('saveAsIpYml');
  });
});
