import { expect, type Page } from "@playwright/test";

/** Wait until the demo document has rendered on the canvas. */
export async function waitForCanvas(page: Page): Promise<void> {
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toBeVisible();
}

/** History counter in the side panel, e.g. "History (2)". */
export async function historyCount(page: Page): Promise<number> {
  const text = await page.getByText(/^History \(\d+\)$/).textContent();
  const m = /History \((\d+)\)/.exec(text ?? "");
  return m ? Number(m[1]) : NaN;
}
