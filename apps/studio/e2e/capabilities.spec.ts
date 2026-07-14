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
  await page.getByRole("menuitem", { name: "Auto layout ↓" }).click();
  await expect.poll(() => nodeTransforms(nodes)).not.toEqual(before);
  expect(await historyCount(page)).toBe(1);

  await page.getByRole("button", { name: "↩" }).click();
  await expect.poll(() => nodeTransforms(nodes)).toEqual(before);
  expect(await historyCount(page)).toBe(0);
});

test("search highlights canvas matches, navigates results, and remains read-only", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const search = page.getByPlaceholder("search nodes…");
  const cpeA = page.locator('.react-flow__node[data-id="cpe1"]');
  const cpeB = page.locator('.react-flow__node[data-id="cpe2"]');
  const firewall = page.locator('.react-flow__node[data-id="fw"]');
  const viewport = page.locator(".react-flow__viewport");
  const viewportTransform = () =>
    viewport.evaluate((element) => (element as HTMLElement).style.transform);

  await search.fill("CPE");
  await expect(page.getByText(/8 nodes · 7 edges · 2 groups · 2 match\(es\)/)).toBeVisible();
  await expect(page.getByLabel("Search result position")).toHaveText("1 / 2");
  await expect(cpeA.locator('[data-search-match="true"]')).toBeVisible();
  await expect(cpeA.locator('[data-search-current="true"]')).toBeVisible();
  await expect(cpeB.locator('[data-search-match="true"]')).toBeVisible();
  await expect(firewall.locator('[data-search-dimmed="true"]')).toBeVisible();
  const firstViewport = await viewportTransform();

  await search.press("Enter");
  await expect(page.getByLabel("Search result position")).toHaveText("2 / 2");
  await expect(cpeB.locator('[data-search-current="true"]')).toBeVisible();
  await expect.poll(viewportTransform).not.toBe(firstViewport);

  await search.press("Shift+Enter");
  await expect(page.getByLabel("Search result position")).toHaveText("1 / 2");
  await expect(cpeA.locator('[data-search-current="true"]')).toBeVisible();

  await search.fill("");
  await expect(cpeA.locator("[data-search-match]")).toHaveCount(0);
  await expect(firewall.locator("[data-search-dimmed]")).toHaveCount(0);

  await search.fill("PostgreSQL");
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("db"); // id cell stays plain text
  await expect(rows.first().locator("input").nth(1)).toHaveValue("PostgreSQL"); // label cell is editable
  expect(await historyCount(page)).toBe(0);
});
