import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { docFromYaml, parseMermaid } from "@topox/interop";
import { waitForCanvas } from "./helpers";

async function exportFromMenu(page: Page, itemName: string): Promise<{ filename: string; body: string }> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("menuitem").filter({ hasText: itemName }).click();
  const download = await downloadPromise;
  return {
    filename: download.suggestedFilename(),
    body: await readFile(await download.path(), "utf8"),
  };
}

test("File menu downloads parseable JSON, YAML, Mermaid, and CSV exports", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const json = await exportFromMenu(page, "Export JSON");
  expect(json.filename).toBe("demo.topox.json");
  const jsonDoc = JSON.parse(json.body) as { graph: { id: string; nodes: unknown[]; edges: unknown[] } };
  expect(jsonDoc.graph.id).toBe("demo");
  expect(jsonDoc.graph.nodes).toHaveLength(8);
  expect(jsonDoc.graph.edges).toHaveLength(7);

  const yaml = await exportFromMenu(page, "Export YAML");
  expect(yaml.filename).toBe("demo.topox.yaml");
  const yamlDoc = docFromYaml(yaml.body);
  expect(yamlDoc.graph.id).toBe("demo");
  expect(yamlDoc.graph.nodes.find((node) => node.id === "db")?.label).toBe("PostgreSQL");

  const mermaid = await exportFromMenu(page, "Export Mermaid");
  expect(mermaid.filename).toBe("demo.mmd");
  const parsedMermaid = parseMermaid(mermaid.body);
  expect(parsedMermaid.warnings).toEqual([]);
  expect(parsedMermaid.doc.graph.nodes).toHaveLength(8);
  expect(parsedMermaid.doc.graph.edges).toHaveLength(7);
  expect(parsedMermaid.doc.graph.groups).toHaveLength(2);

  const csv = await exportFromMenu(page, "Export CSV inventory");
  expect(csv.filename).toBe("demo.inventory.csv");
  const csvRows = csv.body.split(/\r?\n/).map((row) => row.split(","));
  expect(csvRows).toHaveLength(9);
  expect(csvRows[0]).toEqual([
    "id",
    "type",
    "label",
    "description",
    "ref",
    "tags",
    "group",
    "connections",
  ]);
  expect(csvRows.slice(1).every((row) => row.length === 8)).toBe(true);
  expect(csv.body).toContain("db,net-database,PostgreSQL");
});
