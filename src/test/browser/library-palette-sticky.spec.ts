import { test, expect } from '@playwright/test';
import path from 'path';

test('keeps the current Library section heading visible while its items scroll', async ({
  page,
}) => {
  const harnessPath = `file://${path.resolve(__dirname, 'ipcore.html')}`;
  const readyPromise = page.waitForEvent('console', {
    predicate: (message) =>
      message.text().includes('VSCODE_MESSAGE:') && message.text().includes('"ready"'),
    timeout: 10000,
  });

  await page.setViewportSize({ width: 800, height: 360 });
  await page.goto(harnessPath);
  await page.waitForSelector('#ipcore-root');
  await readyPromise;

  const busLibrary = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `XILINX_INTERFACE_${index}`,
      {
        busType: {
          vendor: 'xilinx.com',
          library: 'interface',
          name: `interface_${index}`,
          version: '1.0',
        },
      },
    ])
  );

  await page.evaluate((library) => {
    window.postMessage(
      {
        type: 'update',
        text: `
vlnv:
  vendor: test.com
  library: test
  name: sticky_headers
  version: 1.0.0
`,
        fileName: 'sticky_headers.ip.yml',
        imports: { busLibrary: library },
      },
      '*'
    );
  }, busLibrary);

  const content = page.locator('.library-palette__content');
  const sectionHeading = page.getByRole('button', { name: 'User Interfaces' });
  await expect(sectionHeading).toBeVisible();

  await content.evaluate((scrollContainer) => {
    const heading = Array.from(
      scrollContainer.querySelectorAll<HTMLElement>('.library-palette__category-header')
    ).find((element) => element.textContent?.includes('User Interfaces'));
    if (!heading) {
      throw new Error('User Interfaces heading not found');
    }

    const headingTop = heading.getBoundingClientRect().top;
    const contentTop = scrollContainer.getBoundingClientRect().top;
    scrollContainer.scrollTop += headingTop - contentTop + 48;
  });

  await expect(sectionHeading).toHaveCSS('position', 'sticky');
  await expect
    .poll(async () => {
      const [contentBox, headingBox] = await Promise.all([
        content.boundingBox(),
        sectionHeading.boundingBox(),
      ]);
      if (!contentBox || !headingBox) {
        return Number.POSITIVE_INFINITY;
      }
      return Math.abs(headingBox.y - contentBox.y);
    })
    .toBeLessThan(1);
});
