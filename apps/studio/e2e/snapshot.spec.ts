import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { historyCount, waitForCanvas } from "./helpers";

async function saveSnapshot(page: Page): Promise<{ filename: string; body: string }> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("menuitem", { name: /Save runtime snapshot/ }).click();
  const download = await downloadPromise;
  return {
    filename: download.suggestedFilename(),
    body: await readFile(await download.path(), "utf8"),
  };
}

async function loadSnapshot(page: Page, body: string): Promise<void> {
  await page.getByRole("button", { name: "File ▾" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /Load runtime snapshot/ }).click();
  await (
    await chooser
  ).setFiles({
    name: "capture.topox-runtime.json",
    mimeType: "application/json",
    buffer: Buffer.from(body),
  });
}

test("saves runtime events and loads them after refresh for replay and frame stepping", async ({
  page,
}) => {
  await page.goto("/");
  await waitForCanvas(page);

  const firewall = page.locator('.react-flow__node[data-id="fw"]');
  await page.getByRole("button", { name: "Simulate" }).click();
  await expect(firewall).toContainText(/cpu \d/, { timeout: 3_000 });
  const firstTick = await firewall.innerText();
  await expect.poll(() => firewall.innerText(), { timeout: 3_000 }).not.toBe(firstTick);

  const saved = await saveSnapshot(page);
  expect(saved.filename).toBe("demo.topox-runtime.json");
  const payload = JSON.parse(saved.body) as Record<string, unknown>;
  expect(payload["format"]).toBe("topox-runtime-snapshot");
  expect(payload["version"]).toBe(1);
  expect(payload["range"]).toEqual(
    expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
  );
  expect(payload["events"]).toEqual(expect.any(Array));
  expect((payload["events"] as unknown[]).length).toBeGreaterThan(0);
  expect(payload).not.toHaveProperty("graph");
  expect(payload).not.toHaveProperty("views");

  await page.reload();
  await waitForCanvas(page);
  await loadSnapshot(page, saved.body);

  await expect(page.getByText(/^REPLAY /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Simulate" })).toBeVisible();
  await expect.poll(() => firewall.innerText()).toBe(firstTick);
  await expect(page.getByTitle("Previous event")).toBeDisabled();
  await expect(page.getByTitle("Next event")).toBeEnabled();
  const replayAtStart = await page.getByText(/^REPLAY /).textContent();
  await page.getByTitle("Next event").click();
  await expect.poll(() => page.getByText(/^REPLAY /).textContent()).not.toBe(replayAtStart);
  await expect.poll(() => firewall.innerText()).not.toBe(firstTick);
  await page.getByTitle("Replay from here").click();
  await expect(page.getByTitle("Pause")).toBeVisible();
  await page.getByTitle("Pause").click();
  expect(await historyCount(page)).toBe(0);
});

test("rejects an unsupported snapshot without changing the current replay", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const firewall = page.locator('.react-flow__node[data-id="fw"]');
  await page.getByRole("button", { name: "Simulate" }).click();
  await expect(firewall).toContainText(/cpu \d/, { timeout: 3_000 });
  const firstTick = await firewall.innerText();
  await expect.poll(() => firewall.innerText(), { timeout: 3_000 }).not.toBe(firstTick);
  await page.locator('input[type="range"]').press("Home");
  await expect.poll(() => firewall.innerText()).toBe(firstTick);

  const replayBefore = await page.getByText(/^REPLAY /).textContent();
  const valid = JSON.parse((await saveSnapshot(page)).body) as Record<string, unknown>;
  await loadSnapshot(page, JSON.stringify({ ...valid, version: 2 }));

  await expect(page.getByText(/snapshot import failed: unsupported runtime snapshot version: 2/)).toBeVisible();
  expect(await page.getByText(/^REPLAY /).textContent()).toBe(replayBefore);
  await expect.poll(() => firewall.innerText()).toBe(firstTick);
  expect(await historyCount(page)).toBe(0);
  await expect(page.getByText(/8 nodes · 7 edges · 2 groups/)).toBeVisible();
});
