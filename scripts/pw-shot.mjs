// Read-only page probe for pw-container.sh: navigates, never clicks. Prints console errors,
// failed requests and visible text; saves a screenshot when given an output path.
import { chromium } from "@playwright/test";

const [url, shot] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
page.on("console", (m) => ["error", "warning"].includes(m.type()) && console.log(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => r.status() >= 400 && console.log(`[http ${r.status()}] ${r.url()}`));
await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
if (shot) await page.screenshot({ path: shot, fullPage: true });
console.log("[title]", await page.title());
console.log("[text]", (await page.innerText("body")).slice(0, 2000));
await browser.close();
