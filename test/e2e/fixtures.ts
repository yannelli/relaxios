import { test as base, expect } from '@playwright/test';

// Opens the test page and waits until relaxios, its subpaths and real axios are loaded on window.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).ready === true);
    await use(page);
  },
});

export { expect };

/** Cross-origin base URL (different host, same server). */
export const OTHER_ORIGIN = 'http://127.0.0.1:4173';
