import { expect, test } from "@playwright/test";
import { historyCount, waitForCanvas } from "./helpers";

test("simulation overlays runtime data and clears it without changing the document", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const firewall = page.locator('.react-flow__node[data-id="fw"]');
  await expect(page.getByText(/8 nodes · 7 edges · 2 groups/)).toBeVisible();
  expect(await historyCount(page)).toBe(0);

  await page.getByRole("button", { name: "Simulate" }).click();
  await expect(page.getByRole("button", { name: "◉ Live" })).toBeVisible();
  await expect(firewall.locator("span[title]")).toHaveCount(1, { timeout: 3_000 });
  await expect(firewall).toContainText(/cpu \d/);
  await expect(firewall).toContainText(/lat_ms \d/);

  await page.getByRole("button", { name: "◉ Live" }).click();
  await expect(page.getByRole("button", { name: "Simulate" })).toBeVisible();
  await expect(firewall.locator("span[title]")).toHaveCount(0);
  await expect(firewall).not.toContainText(/cpu \d/);
  await expect(page.getByText(/8 nodes · 7 edges · 2 groups/)).toBeVisible();
  expect(await historyCount(page)).toBe(0);
});

test("Timeline seeks to historical runtime state and supports pause and resume", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const firewall = page.locator('.react-flow__node[data-id="fw"]');
  await page.getByRole("button", { name: "Simulate" }).click();
  await expect(firewall).toContainText(/cpu \d/, { timeout: 3_000 });
  const firstTick = await firewall.innerText();

  await expect
    .poll(() => firewall.innerText(), { timeout: 3_000 })
    .not.toBe(firstTick);
  const liveTick = await firewall.innerText();

  const slider = page.locator('input[type="range"]');
  await expect(slider).toBeVisible();
  await slider.press("Home");

  await expect(page.getByText(/^REPLAY /)).toBeVisible();
  await expect.poll(() => firewall.innerText()).toBe(firstTick);
  expect(await firewall.innerText()).not.toBe(liveTick);

  const play = page.getByTitle("Replay from here");
  await play.click();
  await expect(page.getByTitle("Pause")).toBeVisible();
  await page.getByTitle("Pause").click();
  await expect(page.getByTitle("Replay from here")).toBeVisible();

  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
});
