import { expect, test, type Page } from "@playwright/test";
import { waitForCanvas } from "./helpers";

/**
 * Shared-studio protocol (?src / &save / &ret): the highest-risk surface —
 * a PUT that overwrites the host's document. The host backend is mocked
 * with page.route, so these tests pin the wire contract exactly.
 */

const REMOTE_DOC = {
  graph: {
    schemaVersion: 1,
    id: "remote",
    meta: { name: "Remote Doc" },
    nodes: [
      { id: "gw", type: "net-router", label: "Gateway" },
      { id: "srv", type: "net-server", label: "App Server" },
    ],
    edges: [{ id: "e1", source: "gw", target: "srv", directed: true }],
    groups: [],
  },
  views: [{ id: "default", name: "Default", layout: { gw: { x: 0, y: 0 }, srv: { x: 220, y: 0 } } }],
};

async function mockDocEndpoint(
  page: Page,
  opts: { putStatus?: () => number; onPut?: (body: unknown) => void } = {},
) {
  await page.route("**/mock/docs/d1*", async (route) => {
    const req = route.request();
    // Match on pathname only — the studio page URL itself carries
    // "?src=/mock/docs/d1" and must not be intercepted.
    if (new URL(req.url()).pathname !== "/mock/docs/d1") {
      await route.fallback();
      return;
    }
    if (req.method() === "GET") {
      await route.fulfill({ json: REMOTE_DOC });
      return;
    }
    if (req.method() === "PUT") {
      opts.onPut?.(req.postDataJSON());
      await route.fulfill({ status: opts.putStatus?.() ?? 200, json: { ok: true } });
      return;
    }
    await route.fallback();
  });
}

async function makeDirty(page: Page) {
  await page.getByRole("button", { name: "Arrange ▾" }).click();
  await page.getByRole("menuitem", { name: /Auto layout/ }).click();
}

test("loads ?src doc, saves layout via PUT, returns to Saved", async ({ page }) => {
  const puts: unknown[] = [];
  await mockDocEndpoint(page, { onPut: (b) => puts.push(b) });

  await page.goto("/?src=/mock/docs/d1&ret=/host-home");
  await expect(page.locator('.react-flow__node[data-id="gw"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await expect(page.getByRole("button", { name: "← Back" })).toBeVisible();

  await makeDirty(page);
  await expect(page.getByRole("button", { name: "Save*" })).toBeVisible();

  await page.getByRole("button", { name: "Save*" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  // The PUT body is the full TopoDoc, layout included — the host stores it as-is.
  expect(puts).toHaveLength(1);
  const body = puts[0] as typeof REMOTE_DOC;
  expect(body.graph.nodes.map((n) => n.id).sort()).toEqual(["gw", "srv"]);
  expect(body.views[0]?.layout["gw"]).toBeDefined();
});

test("failed PUT keeps local edits and can be retried", async ({ page }) => {
  let status = 500;
  let putCount = 0;
  await mockDocEndpoint(page, {
    putStatus: () => status,
    onPut: () => putCount++,
  });

  await page.goto("/?src=/mock/docs/d1");
  await expect(page.locator('.react-flow__node[data-id="gw"]')).toBeVisible();
  await makeDirty(page);

  await page.getByRole("button", { name: "Save*" }).click();
  await expect(page.getByText(/save failed: HTTP 500/)).toBeVisible();
  // Local doc untouched, still dirty, still saveable.
  await expect(page.locator('.react-flow__node[data-id="gw"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Save*" })).toBeEnabled();

  status = 200;
  await page.getByRole("button", { name: "Save*" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(putCount).toBe(2);
});

test("unreachable ?src falls back to demo doc with an error", async ({ page }) => {
  await page.route("**/mock/docs/missing*", (route) =>
    new URL(route.request().url()).pathname === "/mock/docs/missing"
      ? route.fulfill({ status: 404 })
      : route.fallback(),
  );

  await page.goto("/?src=/mock/docs/missing");
  await expect(page.getByText(/load failed: HTTP 404/)).toBeVisible();
  // Demo document still renders; the editor stays usable.
  await waitForCanvas(page);
});
