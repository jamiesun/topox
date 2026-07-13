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

async function importViaMenu(
  page: import("@playwright/test").Page,
  name: string,
  body: string,
  mimeType = "application/json",
) {
  await page.getByRole("button", { name: "File ▾" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /Import…/ }).click();
  await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from(body) });
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

test("importing DOT and GraphML replaces the document through the shared validation path", async ({
  page,
}) => {
  await page.goto("/");
  await waitForCanvas(page);

  await importViaMenu(
    page,
    "network.dot",
    `digraph imported {
      a [label="Router A", topox_type="net-router"];
      b [label="Switch B", topox_type="net-switch"];
      a -> b [id="e1", label="uplink"];
    }`,
    "text/vnd.graphviz",
  );
  await expect(page.locator('.react-flow__node[data-id="a"]')).toContainText("Router A");
  await expect(page.getByText(/2 nodes · 1 edges · 0 groups/)).toBeVisible();

  await importViaMenu(
    page,
    "network.graphml",
    `<?xml version="1.0"?>
    <graphml xmlns="http://graphml.graphdrawing.org/xmlns">
      <key id="label" for="node" attr.name="label" attr.type="string"/>
      <key id="type" for="node" attr.name="type" attr.type="string"/>
      <graph id="graphml-network" edgedefault="directed">
        <node id="x"><data key="label">Gateway X</data><data key="type">net-router</data></node>
        <node id="y"><data key="label">Server Y</data><data key="type">net-server</data></node>
        <edge id="xy" source="x" target="y"/>
      </graph>
    </graphml>`,
    "application/graphml+xml",
  );
  await expect(page.locator('.react-flow__node[data-id="x"]')).toContainText("Gateway X");
  await expect(page.locator('.react-flow__node[data-id="a"]')).toHaveCount(0);
  await expect(page.getByText(/2 nodes · 1 edges · 0 groups/)).toBeVisible();
});

test("broken DOT and GraphML imports keep the existing document", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  await importViaMenu(page, "broken.dot", "digraph broken {", "text/vnd.graphviz");
  await expect(page.getByText(/import failed:.*DOT/i)).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toBeVisible();

  await importViaMenu(
    page,
    "broken.graphml",
    "<graphml><graph>",
    "application/graphml+xml",
  );
  await expect(page.getByText(/import failed:.*GraphML/i)).toBeVisible();
  await expect(page.getByText(/8 nodes · 7 edges · 2 groups/)).toBeVisible();
});
