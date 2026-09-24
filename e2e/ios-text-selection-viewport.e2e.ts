import { devices, expect, test, type Page } from "@playwright/test";
import { seedUIState } from "./ui-state-fixture";

// AppShell detects iOS from the user agent, so a Chromium phone with an iPhone agent runs this too.
test.use({ userAgent: devices["iPhone 15 Pro"].userAgent });

type ViewportWindow = typeof window & { __setVisualViewport: (height: number, offsetTop: number) => void };

async function installMockVisualViewport(page: Page) {
  await page.addInitScript(() => {
    const state = { height: null as number | null, offsetTop: 0 };
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { configurable: true, get: () => state.height ?? window.innerHeight },
      width: { configurable: true, get: () => window.innerWidth },
      offsetTop: { configurable: true, get: () => state.offsetTop },
      pageTop: { configurable: true, get: () => state.offsetTop },
      offsetLeft: { configurable: true, get: () => 0 },
      pageLeft: { configurable: true, get: () => 0 },
      scale: { configurable: true, get: () => 1 },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "__setVisualViewport", {
      configurable: true,
      value: (height: number, offsetTop: number) => {
        state.height = height;
        state.offsetTop = offsetTop;
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
      },
    });
  });
}

test("iPhone text selection and touches in the composer do not move the app", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "The visual-viewport pan regression is phone-only.");

  const response = await page.request.post("/api/chats", {
    data: { name: "iOS selection viewport", mode: "roleplay", characterIds: [] },
  });
  expect(response.ok()).toBeTruthy();
  const chat = (await response.json()) as { id: string };

  try {
    await installMockVisualViewport(page);
    await seedUIState(
      page,
      {
        hasCompletedOnboarding: true,
        rightPanelOpen: false,
        sidebarOpen: false,
        appAccentPulseMode: false,
        chatHelpSeenModes: ["conversation", "roleplay", "game"],
      },
      "if-missing",
    );
    await page.addInitScript((chatId) => localStorage.setItem("marinara-active-chat-id", chatId), chat.id);
    await page.goto("/");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-mari-ios-webkit", "");
    const composer = page.locator("textarea[data-chat-composer]:visible").first();
    await composer.fill("select these words");
    await composer.focus();

    const offsetTop = () =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--mari-visual-viewport-offset-top"));
    const pan = (top: number) =>
      page.evaluate((value) => (window as ViewportWindow).__setVisualViewport(360, value), top);
    const settle = () =>
      page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    // Opening the keyboard always applies.
    await pan(10);
    await expect(html).toHaveAttribute("data-mari-software-keyboard-open", "");
    await expect.poll(offsetTop).toBe("10px");

    // An expanded selection holds the app still while iOS pans for the selection handles...
    await composer.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 6));
    await pan(30);
    await settle();
    expect(await offsetTop()).toBe("10px");
    // ...and the held pan applies once the selection collapses.
    await composer.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 6));
    await expect.poll(offsetTop).toBe("30px");

    // A touch on the field (placing the caret, the Paste callout) holds until it settles after the touch.
    await composer.dispatchEvent("touchstart", { touches: [], changedTouches: [] });
    await pan(50);
    await settle();
    expect(await offsetTop()).toBe("30px");
    await composer.dispatchEvent("touchend", { touches: [], changedTouches: [] });
    await expect.poll(offsetTop).toBe("50px");

    // Closing the keyboard is never held, even mid-selection.
    await composer.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 6));
    await page.evaluate(() => (window as ViewportWindow).__setVisualViewport(window.innerHeight, 0));
    await expect(html).not.toHaveAttribute("data-mari-software-keyboard-open", "");
  } finally {
    await page.request.delete(`/api/chats/${chat.id}?force=true`).catch(() => undefined);
  }
});
