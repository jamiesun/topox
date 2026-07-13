import { expect, test } from "@playwright/test";
import { waitForCanvas } from "./helpers";

const DSL_TEXTAREA = 'textarea[placeholder^="node r1"]';

/** The stats footer lives in the Inspector tab; flip over to read it. */
async function expectStats(page: import("@playwright/test").Page, re: RegExp) {
  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  await expect(page.getByText(re)).toBeVisible();
  await page.getByRole("button", { name: "AI", exact: true }).click();
}

/**
 * Main path 2 — the AI boundary: DSL → compile → Preview → Apply.
 * The DSL textarea is the AI output channel; typing into it exercises the
 * exact same staged-diff pipeline without needing a live LLM.
 */
test("DSL staged diff previews, applies, and undoes", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.locator(DSL_TEXTAREA).fill(
    'node cache "Redis Cache" type=net-database\nedge acs -> cache "sessions"',
  );

  // Preview banner appears; canvas shows the staged node but the doc is untouched.
  await expect(page.getByText(/op\(s\) staged — nothing applied yet/)).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="cache"]')).toBeVisible();
  await expectStats(page, /8 nodes · 7 edges/);

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/op\(s\) staged/)).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="cache"]')).toBeVisible();
  await expectStats(page, /9 nodes · 8 edges/);

  // The applied diff participates in normal undo.
  await page.getByRole("button", { name: "↩" }).click();
  await expect(page.locator('.react-flow__node[data-id="cache"]')).toHaveCount(0);
});

/**
 * Failure path — a bad DSL line surfaces a line-scoped error. Compilation is
 * line-tolerant by design: valid lines still stage, broken ones are reported.
 */
test("invalid DSL reports line error and keeps the doc untouched", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.locator(DSL_TEXTAREA).fill('node ok "Fine"\nedge ok -> ghost');

  await expect(page.getByText(/line 2: .*ghost/)).toBeVisible();
  // The valid line stages, the broken one does not — and the doc itself is unchanged.
  await expect(page.getByText(/1 op\(s\) staged/)).toBeVisible();
  await expectStats(page, /8 nodes · 7 edges/);
});
