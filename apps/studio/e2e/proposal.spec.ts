import { expect, test, type Page } from "@playwright/test";
import { hashDocGraph, type GraphProposal, type TopoDoc } from "@talkincode/topox-core";
import { waitForCanvas } from "./helpers";

const REMOTE_DOC: TopoDoc = {
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

function proposal(baseHash = hashDocGraph(REMOTE_DOC)): GraphProposal {
  return {
    format: "topox-proposal",
    version: 1,
    proposalId: "p-control-plane",
    docId: "remote",
    baseHash,
    createdAt: "2026-07-14T00:00:00.000Z",
    source: "mcp",
    dsl: 'node cp "Control Plane" type=net-cloud\nedge gw -> cp id=e2',
    diff: {
      origin: "mcp",
      summary: "add control plane",
      ops: [
        { op: "add_node", node: { id: "cp", type: "net-cloud", label: "Control Plane" } },
        { op: "add_edge", edge: { id: "e2", source: "gw", target: "cp", directed: true } },
      ],
    },
    summary: [
      { sign: "+", text: "node cp (Control Plane)" },
      { sign: "+", text: "edge gw -> cp" },
    ],
    status: "open",
  };
}

function deletionProposal(baseHash = hashDocGraph(REMOTE_DOC)): GraphProposal {
  return {
    format: "topox-proposal",
    version: 1,
    proposalId: "p-delete-server",
    docId: "remote",
    baseHash,
    createdAt: "2026-07-14T00:00:00.000Z",
    source: "mcp",
    diff: {
      origin: "mcp",
      summary: "delete server",
      ops: [
        { op: "remove_edge", edge: { id: "e1", source: "gw", target: "srv", directed: true } },
        { op: "set_layout", viewId: "default", nodeId: "srv", before: { x: 220, y: 0 }, after: null },
        { op: "remove_node", node: { id: "srv", type: "net-server", label: "App Server" } },
      ],
    },
    summary: [
      { sign: "-", text: "edge gw -> srv" },
      { sign: "-", text: "node srv (App Server)" },
    ],
    status: "open",
  };
}

async function mockDocEndpoint(page: Page) {
  await page.route("**/mock/docs/d1*", async (route) => {
    const req = route.request();
    if (new URL(req.url()).pathname !== "/mock/docs/d1") {
      await route.fallback();
      return;
    }
    if (req.method() === "GET") {
      await route.fulfill({ json: REMOTE_DOC });
      return;
    }
    if (req.method() === "PUT") {
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    await route.fallback();
  });
}

async function mockProposalEndpoint(page: Page, body: GraphProposal) {
  await page.route("**/mock/proposals/p1*", async (route) => {
    if (new URL(route.request().url()).pathname === "/mock/proposals/p1") {
      await route.fulfill({ json: body });
      return;
    }
    await route.fallback();
  });
}

test("opens a shared-mode proposal as a visual preview and applies through history", async ({ page }) => {
  await mockDocEndpoint(page);
  await mockProposalEndpoint(page, proposal());

  await page.goto("/?src=/mock/docs/d1&save=/mock/docs/d1&proposal=/mock/proposals/p1");

  await expect(page.getByText(/Proposal p-control-plane · 2 op\(s\) · ready/)).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="cp"]')).toBeVisible();
  await expect(page.locator('[data-diff-state="added"]').first()).toBeVisible();

  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/Proposal p-control-plane/)).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="cp"]')).toBeVisible();

  await page.getByTitle("Undo").click();
  await expect(page.locator('.react-flow__node[data-id="cp"]')).toHaveCount(0);
});

test("keeps removed entities visible as preview markers", async ({ page }) => {
  await mockDocEndpoint(page);
  await mockProposalEndpoint(page, deletionProposal());

  await page.goto("/?src=/mock/docs/d1&save=/mock/docs/d1&proposal=/mock/proposals/p1");

  await expect(page.getByText(/Proposal p-delete-server · 3 op\(s\) · ready/)).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="srv"]')).toBeVisible();
  await expect(page.locator('[data-diff-state="removed"]').first()).toBeVisible();

  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator('.react-flow__node[data-id="srv"]')).toHaveCount(0);
});

test("shows local project proposals as base unverifiable and disables apply", async ({ page }) => {
  await mockProposalEndpoint(page, proposal());

  await page.goto("/?proposal=/mock/proposals/p1");

  await expect(page.getByText(/Proposal p-control-plane · 2 op\(s\) · unverifiable/)).toBeVisible();
  await expect(page.getByText(/proposal base can only be verified in shared document mode/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await expect(page.locator('.react-flow__node[data-id="cp"]')).toHaveCount(0);
});

test("rejects cross-origin proposal URLs", async ({ page }) => {
  const foreignRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://evil.example")) foreignRequests.push(request.url());
  });

  await page.goto("/?proposal=https://evil.example/p1.json");
  await waitForCanvas(page);

  await expect(page.getByText(/Proposal /)).toHaveCount(0);
  expect(foreignRequests).toEqual([]);
});
