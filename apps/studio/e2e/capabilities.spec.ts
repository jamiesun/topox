import { expect, test, type Locator } from "@playwright/test";
import { historyCount, waitForCanvas } from "./helpers";

async function nodeTransforms(nodes: Locator): Promise<string[]> {
  return nodes.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).style.transform),
  );
}

test("groups selected nodes, collapses and expands them, then ungroups and undoes", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const siteA = page.locator('.react-flow__node[data-id="cpe1"]');
  const siteB = page.locator('.react-flow__node[data-id="cpe2"]');
  const siteABox = await siteA.boundingBox();
  const siteBBox = await siteB.boundingBox();
  if (siteABox === null || siteBBox === null) {
    throw new Error("expected both nodes to have rendered bounds");
  }
  await page.keyboard.down("Shift");
  await page.mouse.move(
    Math.min(siteABox.x, siteBBox.x) - 10,
    Math.min(siteABox.y, siteBBox.y) - 10,
  );
  await page.mouse.down();
  await page.mouse.move(
    Math.max(siteABox.x + siteABox.width, siteBBox.x + siteBBox.width) + 10,
    Math.max(siteABox.y + siteABox.height, siteBBox.y + siteBBox.height) + 10,
  );
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(siteA).toHaveClass(/selected/);
  await expect(siteB).toHaveClass(/selected/);

  await page.getByRole("button", { name: "Arrange ▾" }).click();
  await page.getByRole("menuitem", { name: /Group selection/ }).click();

  const group = page
    .locator('.react-flow__node[data-id^="group:grp-"]')
    .filter({ hasText: "Group (2)" });
  await expect(group).toBeVisible();
  await expect(page.getByText(/8 nodes · 7 edges · 3 groups/)).toBeVisible();

  await group.click({ position: { x: 5, y: 5 } });
  await expect(group).toHaveClass(/selected/);
  await group.getByTitle("Collapse group").click();
  await expect(siteA).toHaveCount(0);
  await expect(siteB).toHaveCount(0);
  await expect(group.getByTitle("Expand group")).toBeVisible();
  await expect(group).toContainText("2 nodes");

  await group.getByTitle("Expand group").click();
  await expect(siteA).toBeVisible();
  await expect(siteB).toBeVisible();
  await expect(group.getByTitle("Collapse group")).toBeVisible();

  await group.getByText("Group (2)", { exact: true }).click();
  await page.getByRole("button", { name: "Arrange ▾" }).click();
  await page.getByRole("menuitem", { name: /Ungroup/ }).click();
  await expect(group).toHaveCount(0);
  await expect(page.getByText(/8 nodes · 7 edges · 2 groups/)).toBeVisible();

  await page.getByRole("button", { name: "↩" }).click();
  await expect(group).toBeVisible();
  await expect(page.getByText(/8 nodes · 7 edges · 3 groups/)).toBeVisible();
});

test("auto layout changes node coordinates and undo restores them", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const nodes = page.locator('.react-flow__node[data-id]:not([data-id^="group:"])');
  const before = await nodeTransforms(nodes);
  expect(await historyCount(page)).toBe(0);

  await page.getByRole("button", { name: "Arrange ▾" }).click();
  await page.getByRole("menuitem", { name: /Auto layout/ }).click();
  await expect.poll(() => nodeTransforms(nodes)).not.toEqual(before);
  expect(await historyCount(page)).toBe(1);

  await page.getByRole("button", { name: "↩" }).click();
  await expect.poll(() => nodeTransforms(nodes)).toEqual(before);
  expect(await historyCount(page)).toBe(0);
});

test("search reports the correct match and filters the inventory without editing", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  await page.getByPlaceholder("search nodes…").fill("PostgreSQL");
  await expect(page.getByText(/8 nodes · 7 edges · 2 groups · 1 match\(es\)/)).toBeVisible();

  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("PostgreSQL");
  expect(await historyCount(page)).toBe(0);
});
