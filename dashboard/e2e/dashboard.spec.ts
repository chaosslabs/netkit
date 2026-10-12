import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

test.describe('Netkit Dashboard E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/compose/');
  });

  test('should load the dashboard', async ({ page }) => {
    await expect(page).toHaveTitle(/netkit/i);
  });

  test('should display request builder form', async ({ page }) => {
    // Check for method selector (combobox based on actual page structure)
    const methodSelector = page.locator('role=combobox').first();
    await expect(methodSelector).toBeVisible();

    // Check for URL input (textbox with placeholder)
    const urlInput = page.getByPlaceholder(/api.example.com/i);
    await expect(urlInput).toBeVisible();

    // Check for send button
    await expect(page.getByRole('button', { name: /send/i })).toBeVisible();
  });

  test('should make a request through the proxy', async ({ page }) => {
    // Fill in the URL
    const urlInput = page.getByPlaceholder(/api.example.com/i);
    await urlInput.fill('https://httpbin.org/get');

    // The method is already GET by default, so we can skip selecting it

    // Click send button
    await page.getByRole('button', { name: /send/i }).click();

    // Wait for response to appear
    await page.waitForTimeout(3000);

    // Check that the response is displayed (look for 200 status code or success text)
    const responseSection = page.locator('text=/200|success/i').first();
    await expect(responseSection).toBeVisible({ timeout: 10000 });
  });

  test('should display proxy request history', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Traffic', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Traffic filters' })).toBeVisible();
    await expect(page.getByLabel('Host', { exact: true })).toBeVisible();
  });

  test('should display request builder heading', async ({ page }) => {
    // Look for Request Builder heading
    const builderHeading = page.locator('text=/Request Builder/i').first();
    await expect(builderHeading).toBeVisible();
  });

  test('should add custom headers to request', async ({ page }) => {
    // Find and click add header button
    const addHeaderButton = page.getByRole('button', { name: /add header/i });

    if (await addHeaderButton.isVisible()) {
      await addHeaderButton.click();

      // Find the empty header name/value inputs (second row since first has User-Agent)
      const headerNameInputs = page.getByPlaceholder(/header name/i);
      const headerValueInputs = page.getByPlaceholder(/header value/i);

      // Get the last (newly added) header inputs
      const newHeaderName = headerNameInputs.last();
      const newHeaderValue = headerValueInputs.last();

      await newHeaderName.fill('X-Custom-Header');
      await newHeaderValue.fill('test-value');

      await expect(newHeaderName).toHaveValue('X-Custom-Header');
    }
  });

  test('should display proxy failures without exposing raw error bodies', async ({ page }) => {
    // Fail a real local upstream exchange without relying on public DNS behavior.
    const upstream = createServer((request) => request.socket.destroy());
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    try {
      const address = upstream.address();
      if (!address || typeof address === 'string') throw new Error('Missing upstream address');
      await page.getByPlaceholder(/api.example.com/i).fill(`http://127.0.0.1:${address.port}/`);
      await page.getByRole('button', { name: /send/i }).click();

      await expect(page.getByText('502', { exact: true })).toBeVisible();
      await expect(page.getByText('[Body omitted: only complete JSON up to 64 KiB is retained]', { exact: true })).toBeVisible();
    } finally {
      await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
    }
  });
});
