import { expect, test } from "@playwright/test";
import { waitForCanvas } from "./helpers";

const VALID_DOC = JSON.stringify({
  graph: {
    schemaVersion: 1,
    id: "imported",
    meta: { name: "Imported" },
    nodes: [
      { id: "a", type: "net-router", label: "Router A" },
      { id: "b", type: "net-switch", label: "Switch B" },
    ],
    edges: [{ id: "e1", source: "a", target: "b", directed: true }],
    groups: [],
  },
  views: [
    {
      id: "default",
      name: "Default",
      layout: { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } },
    },
  ],
});

async function importViaMenu(page: import("@playwright/test").Page, name: string, body: string) {
  await page.getByRole("button", { name: "File ▾" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /Import…/ }).click();
  await (await chooser).setFiles({ name, mimeType: "application/json", buffer: Buffer.from(body) });
}

/** Main path 3 — import replaces the whole document. */
test("importing a valid JSON doc replaces the document", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);
  await expect(page.getByText(/8 nodes · 7 edges/)).toBeVisible();

  await importViaMenu(page, "small.topox.json", VALID_DOC);

  await expect(page.locator('.react-flow__node[data-id="a"]')).toBeVisible();
  await expect(page.getByText(/2 nodes · 1 edges · 0 groups/)).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toHaveCount(0);
});

/** Failure path — invalid payload is rejected and the current doc survives. */
test("importing a broken file keeps the existing document", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  await importViaMenu(page, "broken.json", "{ not json at all");

  await expect(page.getByText(/import failed:/)).toBeVisible();
  await expect(page.getByText(/8 nodes · 7 edges · 2 groups/)).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toBeVisible();
});

/** Failure path — structurally valid JSON that fails doc validation is rejected. */
test("importing a doc that fails validation is rejected", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const dangling = JSON.stringify({
    graph: {
      schemaVersion: 1,
      id: "bad",
      meta: {},
      nodes: [{ id: "a", type: "t", label: "A" }],
      edges: [{ id: "e1", source: "a", target: "missing", directed: true }],
      groups: [],
    },
    views: [{ id: "default", name: "Default", layout: {} }],
  });
  await importViaMenu(page, "dangling.json", dangling);

  await expect(page.getByText(/import failed:/)).toBeVisible();
  await expect(page.getByText(/8 nodes · 7 edges · 2 groups/)).toBeVisible();
});
