import { expect, test } from "@playwright/test";
import { historyCount, waitForCanvas } from "./helpers";

/**
 * Main path — node appearance overrides from the Inspector:
 * pick a background color, watch the canvas restyle, then undo back to theme.
 */
test("style a node from the Appearance section, then undo", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const nodeBox = page.locator('.react-flow__node[data-id="fw"] > div').first();
  await page.locator('.react-flow__node[data-id="fw"]').click();

  await page.getByLabel("background color").fill("#ff0000");
  await expect(nodeBox).toHaveCSS("background-color", "rgb(255, 0, 0)");
  expect(await historyCount(page)).toBe(1);

  // Border style is part of the same style bag — one more undoable diff.
  await page.locator("label:has-text('border style') + select").selectOption("dashed");
  expect(await historyCount(page)).toBe(2);

  await page.getByRole("button", { name: "reset all styles" }).click();
  await expect(nodeBox).not.toHaveCSS("background-color", "rgb(255, 0, 0)");
  expect(await historyCount(page)).toBe(3);

  await page.getByRole("button", { name: "↩" }).click();
  await expect(nodeBox).toHaveCSS("background-color", "rgb(255, 0, 0)");
  await page.getByRole("button", { name: "↩" }).click();
  await page.getByRole("button", { name: "↩" }).click();
  await expect(nodeBox).not.toHaveCSS("background-color", "rgb(255, 0, 0)");
  expect(await historyCount(page)).toBe(0);
});

/**
 * Main path — inventory as a global quick-edit surface:
 * change a label in the table, see the canvas update, then undo.
 */
test("edit a node label from the inventory table, then undo", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  await page.getByRole("button", { name: "Inventory" }).click();
  const labelCell = page.locator("tr", { hasText: "fw" }).locator("input").nth(1);
  await expect(labelCell).toHaveValue("Firewall");
  await labelCell.fill("Perimeter FW");
  await labelCell.press("Enter");
  expect(await historyCount(page)).toBe(1);

  await page.getByRole("button", { name: "Canvas" }).click();
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toContainText("Perimeter FW");

  await page.getByRole("button", { name: "↩" }).click();
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toContainText("Firewall");
  expect(await historyCount(page)).toBe(0);
});

/** Theme cycles system → light → dark and persists via the html attribute. */
test("theme toggle cycles light and dark modes", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const html = page.locator("html");
  const toggle = page.getByRole("button", { name: "Toggle theme" });
  await expect(html).toHaveAttribute("data-theme", "light"); // system resolves light in tests
  await expect(toggle).toHaveText("◐ Auto");
  await toggle.click();
  await expect(toggle).toHaveText("☀ Light");
  await expect(html).toHaveAttribute("data-theme", "light");
  await toggle.click();
  await expect(toggle).toHaveText("☾ Dark");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await toggle.click();
  await expect(toggle).toHaveText("◐ Auto"); // back to system
  await expect(html).toHaveAttribute("data-theme", "light");
});

/**
 * Main path — the floating selection bar makes grouping discoverable:
 * select two nodes, Group from the bar, then Ungroup, then undo both.
 */
test("selection action bar groups and ungroups nodes", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  await page.locator(".react-flow__controls-fitview").click();
  const cpe1 = page.locator('.react-flow__node[data-id="cpe1"]');
  const cpe2 = page.locator('.react-flow__node[data-id="cpe2"]');
  await expect(async () => {
    await cpe1.click();
    await expect(cpe1).toHaveClass(/selected/, { timeout: 500 });
  }).toPass();
  await expect(async () => {
    await cpe2.click({ modifiers: ["Meta"] });
    await expect(page.getByRole("toolbar", { name: "Selection actions" })).toContainText(
      "2 selected",
      { timeout: 500 },
    );
  }).toPass();

  const bar = page.getByRole("toolbar", { name: "Selection actions" });
  await bar.getByRole("button", { name: "Group" }).click();
  const group = page.locator('.react-flow__node[data-id^="group:grp-"]');
  await expect(group).toHaveCount(1);
  expect(await historyCount(page)).toBe(1);

  // Select the group via its title (top-left corner is the collapse toggle).
  await group.getByText("Group (2)").click();
  await bar.getByRole("button", { name: "Ungroup" }).click();
  await expect(group).toHaveCount(0);
  expect(await historyCount(page)).toBe(2);

  await page.getByRole("button", { name: "↩" }).click();
  await expect(group).toHaveCount(1);
  await page.getByRole("button", { name: "↩" }).click();
  await expect(group).toHaveCount(0);
  expect(await historyCount(page)).toBe(0);
});

/**
 * Save visibility — an ephemeral diagram advertises that it is unsaved;
 * saving it as a project flips the topbar into the auto-save indicator.
 */
test("topbar shows unsaved state, then auto-save confirmation after saving as project", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const unsaved = page.getByRole("button", { name: "Unsaved — Save…" });
  await expect(unsaved).toBeVisible();

  page.once("dialog", (d) => void d.accept("Save Check"));
  await unsaved.click();

  await expect(unsaved).toHaveCount(0);
  await expect(page.getByText("✓ Saved")).toBeVisible();

  // Cmd+S is a no-surprise save: keeps the indicator green instead of the browser dialog.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  await expect(page.getByText("✓ Saved")).toBeVisible();
});
