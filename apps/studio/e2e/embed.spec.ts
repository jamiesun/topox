import { expect, test } from "@playwright/test";

test("plain HTML host mounts, receives runtime events, and destroys the embed", async ({ page }) => {
  await page.goto("http://localhost:8091/");

  const canvas = page.locator("#canvas");
  const firewall = canvas.locator('.react-flow__node[data-id="fw"]');
  await expect(firewall).toBeVisible();
  await expect(firewall).toContainText("Firewall");
  expect(await page.evaluate(() => typeof (window as Window & { React?: unknown }).React)).toBe("undefined");

  await page.evaluate(`
    view.pushRuntimeEvent({
      kind: "node",
      key: "dev:fw-01",
      patch: {
        status: "error",
        message: "forced failure",
        metrics: { cpu: 91, latency: 250 }
      },
      ts: 1234
    })
  `);
  await expect(firewall.locator('span[title="error: forced failure"]')).toBeVisible();
  await expect(firewall).toContainText("cpu 91");
  await expect(firewall).toContainText("latency 250");

  await page.evaluate("view.destroy()");
  await expect(canvas.locator(":scope > *")).toHaveCount(0);
});
