import { expect, test } from "@playwright/test";
import { historyCount, waitForCanvas } from "./helpers";

/**
 * Main path 1 — graph editing through the Inspector:
 * select a node, rename it, watch the canvas update, then undo.
 */
test("edit node label via Inspector, then undo", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  await page.locator('.react-flow__node[data-id="fw"]').click();
  await expect(page.getByText("Firewall", { exact: true }).first()).toBeVisible();

  const labelField = page.locator("label:has-text('label') + input").first();
  await expect(labelField).toHaveValue("Firewall");
  await labelField.fill("Edge Firewall");
  await labelField.press("Enter");

  // Canvas node re-renders with the new label; history gains one entry.
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toContainText("Edge Firewall");
  expect(await historyCount(page)).toBe(1);

  await page.getByRole("button", { name: "↩" }).click();
  await expect(page.locator('.react-flow__node[data-id="fw"]')).toContainText("Firewall");
  await expect(page.locator('.react-flow__node[data-id="fw"]')).not.toContainText("Edge Firewall");
  expect(await historyCount(page)).toBe(0);
});

test("insert nodes from the Insert menu, connect them, then undo", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const inserted = page.locator('.react-flow__node[data-id^="n-"]');
  const edges = page.locator(".react-flow__edge");
  const edgeCountBefore = await edges.count();

  await page.getByRole("button", { name: "Insert ▾" }).click();
  await page.getByRole("menuitem", { name: "Router", exact: false }).first().click();
  await expect(inserted).toHaveCount(1);
  await expect(inserted.first()).toContainText("net-router");
  expect(await historyCount(page)).toBe(1);

  await page.getByRole("button", { name: "Insert ▾" }).click();
  await page.getByRole("menuitem", { name: "Switch", exact: false }).first().click();
  await expect(inserted).toHaveCount(2);
  expect(await historyCount(page)).toBe(2);

  // Bring the freshly inserted nodes into view before selecting them. The
  // fit-view transition animates the viewport, so retry until the click lands.
  await page.locator(".react-flow__controls-fitview").click();
  await expect(async () => {
    await inserted.nth(0).click();
    await expect(inserted.nth(0)).toHaveClass(/selected/, { timeout: 500 });
  }).toPass();
  await expect(async () => {
    await inserted.nth(1).click({ modifiers: ["Meta"] });
    await expect(page.getByText("2 items selected")).toBeVisible({ timeout: 500 });
  }).toPass();

  await page.getByRole("button", { name: "Arrange ▾" }).click();
  await page.getByRole("menuitem", { name: /Connect selection/ }).click();
  await expect(edges).toHaveCount(edgeCountBefore + 1);
  expect(await historyCount(page)).toBe(3);

  // Undo unwinds the edge, then each inserted node.
  await page.getByRole("button", { name: "↩" }).click();
  await expect(edges).toHaveCount(edgeCountBefore);
  await page.getByRole("button", { name: "↩" }).click();
  await page.getByRole("button", { name: "↩" }).click();
  await expect(inserted).toHaveCount(0);
  expect(await historyCount(page)).toBe(0);
});

test("duplicate selection from Arrange or shortcut, then undo", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const source = page.locator('.react-flow__node[data-id="fw"]');
  await source.click();
  const sourcePosition = await source.evaluate((element) => {
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
      (element as HTMLElement).style.transform,
    );
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  });

  await page.getByRole("button", { name: "Arrange ▾" }).click();
  await page.getByRole("menuitem", { name: /Duplicate selection/ }).click();

  const copy = page.locator('.react-flow__node[data-id="fw-copy"]');
  await expect(copy).toBeVisible();
  await expect(copy).toContainText("Firewall");
  const copyPosition = await copy.evaluate((element) => {
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
      (element as HTMLElement).style.transform,
    );
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  });
  expect(copyPosition).toEqual({ x: sourcePosition.x + 32, y: sourcePosition.y + 32 });
  expect(await historyCount(page)).toBe(1);

  await page.getByRole("button", { name: "↩" }).click();
  await expect(copy).toHaveCount(0);
  expect(await historyCount(page)).toBe(0);

  await page.keyboard.press("Meta+d");
  await expect(copy).toBeVisible();
  expect(await historyCount(page)).toBe(1);
});

test("lock prevents movement until the lock change is undone", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);

  const node = page.locator('.react-flow__node[data-id="fw"]');
  await node.click();
  const locked = page.getByRole("checkbox", { name: "locked" });
  await locked.check();

  await expect(node.locator('[data-locked="true"]')).toBeVisible();
  expect(await historyCount(page)).toBe(1);
  const lockedPosition = await node.getAttribute("style");
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y + box!.height / 2 + 50, {
    steps: 8,
  });
  await page.mouse.up();

  expect(await node.getAttribute("style")).toBe(lockedPosition);
  expect(await historyCount(page)).toBe(1);
  await expect(node).toHaveClass(/selected/);

  const peer = page.locator('.react-flow__node[data-id="r1"]');
  const peerPosition = await peer.getAttribute("style");
  await page.keyboard.down("Shift");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await peer.click();
  await page.keyboard.up("Shift");
  await expect(page.getByText("2 items selected")).toBeVisible();
  const peerBox = await peer.boundingBox();
  expect(peerBox).not.toBeNull();
  await page.mouse.move(peerBox!.x + peerBox!.width / 2, peerBox!.y + peerBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    peerBox!.x + peerBox!.width / 2 + 90,
    peerBox!.y + peerBox!.height / 2 + 50,
    { steps: 8 },
  );
  await page.mouse.up();

  expect(await node.getAttribute("style")).toBe(lockedPosition);
  await expect.poll(() => peer.getAttribute("style")).not.toBe(peerPosition);
  expect(await historyCount(page)).toBe(2);

  await page.getByRole("button", { name: "↩" }).click();
  await expect.poll(() => peer.getAttribute("style")).toBe(peerPosition);
  expect(await historyCount(page)).toBe(1);
  await page.getByRole("button", { name: "↩" }).click();
  await expect(node.locator('[data-locked="true"]')).toHaveCount(0);
  await node.click();
  await expect(locked).not.toBeChecked();
  expect(await historyCount(page)).toBe(0);

  const unlockedBox = await node.boundingBox();
  expect(unlockedBox).not.toBeNull();
  await page.mouse.move(
    unlockedBox!.x + unlockedBox!.width / 2,
    unlockedBox!.y + unlockedBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    unlockedBox!.x + unlockedBox!.width / 2 + 90,
    unlockedBox!.y + unlockedBox!.height / 2 + 50,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect.poll(() => node.getAttribute("style")).not.toBe(lockedPosition);
  expect(await historyCount(page)).toBe(1);
});

test("dragging near an edge snaps with a guide and commits one undoable move", async ({
  page,
}) => {
  await page.goto("/");
  await waitForCanvas(page);

  const moving = page.locator('.react-flow__node[data-id="db"]');
  const target = page.locator('.react-flow__node[data-id="fw"]');
  const readPosition = (selector: typeof moving) =>
    selector.evaluate((element) => {
      const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
        (element as HTMLElement).style.transform,
      );
      return { x: Number(match?.[1]), y: Number(match?.[2]) };
    });
  const start = await readPosition(moving);
  const targetPosition = await readPosition(target);
  const zoom = await page.locator(".react-flow__viewport").evaluate((element) => {
    return new DOMMatrix(getComputedStyle(element).transform).a;
  });
  const box = await moving.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 2, box!.y + box!.height / 2);
  await page.mouse.move(
    box!.x + box!.width / 2 + 2 + (targetPosition.x - start.x - 3) * zoom,
    box!.y + box!.height / 2,
    { steps: 10 },
  );
  await expect(page.locator('[data-alignment-guide="vertical"]')).toBeVisible();
  await page.mouse.up();

  await expect.poll(async () => (await readPosition(moving)).x).toBe(targetPosition.x);
  expect(await historyCount(page)).toBe(1);
  await page.getByRole("button", { name: "↩" }).click();
  await expect.poll(() => readPosition(moving)).toEqual(start);
  expect(await historyCount(page)).toBe(0);
});
