import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"
import { STAFF_STATE } from "./global-setup.ts"

// PLAN §13: no serious violations
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

async function serious(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)
}

// Navigation itself: flows.e2e.ts
async function openFirst(page: Page, list: string, prefix: string) {
  await page.goto(list)
  const href = await page
    .locator(`main a[href^="${prefix}"]`)
    .first()
    .getAttribute("href")
  expect(href).not.toBeNull()
  await page.goto(href ?? list)
  await expect(page).toHaveURL(new RegExp(prefix))
}

const PUBLIC = [
  "/",
  "/isu",
  "/data",
  "/tentang",
  "/privasi",
  "/pedoman",
  "/aksesibilitas",
  "/lapor",
  "/masuk",
  "/lacak",
  "/tuntutan",
  "/data?lapisan=tuntutan",
]

for (const path of PUBLIC) {
  test(`public ${path} has no serious axe violation`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    expect(await serious(page)).toEqual([])
  })
}

test("an issue page has no serious axe violation", async ({ page }) => {
  await openFirst(page, "/isu", "/isu/ISU-")
  expect(await serious(page)).toEqual([])
})

test("a tuntutan and its complaint form have no serious axe violation", async ({
  page,
}) => {
  await openFirst(page, "/tuntutan", "/tuntutan/TUN-")
  expect(await serious(page)).toEqual([])
  const response = await page.goto(`${new URL(page.url()).pathname}/laporkan`)
  expect(response?.status()).toBe(200)
  expect(await serious(page)).toEqual([])
})

test.describe("staff", () => {
  test.use({ storageState: STAFF_STATE })
  const STAFF = [
    "/kelola",
    "/kelola/antrean",
    "/kelola/isu",
    "/kelola/aduan",
    "/kelola/audit",
    "/kelola/anggota",
    "/kelola/pengaturan",
    "/kelola/tuntutan",
    "/kelola/tuntutan/baru",
    // Platform operator, same account
    "/admin",
    "/admin/whatsapp",
  ]
  for (const path of STAFF) {
    test(`${path} has no serious axe violation`, async ({ page }) => {
      const response = await page.goto(path)
      expect(response?.status()).toBe(200)
      expect(await serious(page)).toEqual([])
    })
  }

  test("a tuntutan editor has no serious axe violation", async ({ page }) => {
    await openFirst(page, "/kelola/tuntutan", "/kelola/tuntutan/TUN-")
    expect(await serious(page)).toEqual([])
  })
})
