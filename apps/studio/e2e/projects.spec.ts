import { expect, test, type Page } from "@playwright/test";
import { waitForCanvas } from "./helpers";

/**
 * Local project management: diagrams are stored in localStorage, auto-saved
 * on every accepted change, restored on reload, and switchable from the
 * Projects menu. Shared-studio mode (?src=) bypasses all of this.
 */

async function projectsMenu(page: Page, buttonName: RegExp | string) {
  await page.getByRole("button", { name: buttonName }).click();
}

test("save current diagram as a project; edits persist across reload", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  page.once("dialog", (d) => void d.accept("My ISP"));
  await projectsMenu(page, "Projects ▾");
  await page.getByRole("menuitem", { name: /Save as project/ }).click();
  await expect(page.getByRole("button", { name: "My ISP ▾" })).toBeVisible();

  // Edit through the Inspector; the debounced auto-save must reach storage.
  await page.locator('.react-flow__node[data-id="fw"]').click();
  const labelField = page.locator("label:has-text('label') + input").first();
  await labelField.fill("Edge FW");
  await labelField.press("Enter");
  await page.waitForFunction(() =>
    Object.keys(window.localStorage).some(
      (key) =>
        key.endsWith(".doc") && (window.localStorage.getItem(key) ?? "").includes("Edge FW"),
    ),
  );

  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toContainText("Edge FW");
  await expect(page.getByRole("button", { name: "My ISP ▾" })).toBeVisible();
});

test("new project starts blank and switching projects swaps documents", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  page.once("dialog", (d) => void d.accept("Demo Keep"));
  await projectsMenu(page, "Projects ▾");
  await page.getByRole("menuitem", { name: /Save as project/ }).click();
  await expect(page.getByRole("button", { name: "Demo Keep ▾" })).toBeVisible();

  page.once("dialog", (d) => void d.accept("Blank One"));
  await projectsMenu(page, "Demo Keep ▾");
  await page.getByRole("menuitem", { name: /New project/ }).click();
  await expect(page.getByRole("button", { name: "Blank One ▾" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(0);

  await projectsMenu(page, "Blank One ▾");
  await page.getByRole("menuitem", { name: "Demo Keep" }).click();
  await waitForCanvas(page);
  await expect(page.getByRole("button", { name: "Demo Keep ▾" })).toBeVisible();
});

test("deleting a project falls back to the demo document", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  page.once("dialog", (d) => void d.accept("Doomed"));
  await projectsMenu(page, "Projects ▾");
  await page.getByRole("menuitem", { name: /New project/ }).click();
  await expect(page.getByRole("button", { name: "Doomed ▾" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(0);

  page.once("dialog", (d) => void d.accept());
  await projectsMenu(page, "Doomed ▾");
  await page.getByRole("menuitem", { name: "Delete project" }).click();

  await waitForCanvas(page);
  await expect(page.getByRole("button", { name: "Projects ▾" })).toBeVisible();
  const stored = await page.evaluate(() => window.localStorage.getItem("topox.projects"));
  expect(stored === null || stored === "[]").toBe(true);
});
