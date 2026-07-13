import { expect, test } from "@playwright/test";
import { historyCount, waitForCanvas } from "./helpers";

/**
 * Main path 1 — graph editing through the Inspector:
 * select a node, rename it, watch the canvas update, then undo.
 */
test("edit node label via Inspector, then undo", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  await page.locator('.react-flow__node[data-id="fw"]').click();
  await expect(page.getByText("Firewall", { exact: true }).first()).toBeVisible();

  const labelField = page.locator("label:has-text('label') + input").first();
  await expect(labelField).toHaveValue("Firewall");
  await labelField.fill("Edge Firewall");
  await labelField.press("Enter");

  // Canvas node re-renders with the new label; history gains one entry.
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toContainText("Edge Firewall");
  expect(await historyCount(page)).toBe(1);

  await page.getByRole("button", { name: "↩" }).click();
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toContainText("Firewall");
  await expect(page.locator('.react-flow__node[data-id="fw"]')).not.toContainText("Edge Firewall");
  expect(await historyCount(page)).toBe(0);
});
