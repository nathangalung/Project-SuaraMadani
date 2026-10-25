import { expect, test } from "@playwright/test"

test("a reader finds an issue and is asked to sign in to follow", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByRole("link", { name: "Jelajah" }).first().click()
  await expect(page).toHaveURL(/\/isu$/)
  await page.locator('main a[href^="/isu/ISU-"]').first().click()
  const follow = page.locator('a[href^="/masuk?kembali=%2Fisu%2F"]').first()
  await expect(follow).toBeVisible()
  await follow.click()
  await expect(page).toHaveURL(/\/masuk\?kembali=/)
  await expect(page.locator("h1")).toBeVisible()
})

test("the report form starts and keeps its draft", async ({ page }) => {
  await page.goto("/lapor")
  await expect(page.locator("h1")).toBeVisible()
  await page.locator('input[name="relation"]').first().check()
  await page.getByRole("button", { name: "Lanjutkan" }).click()
  await expect(page).toHaveURL(/\/lapor\/lokasi$/)
  await page.goBack()
  await expect(page.locator('input[name="relation"]').first()).toBeChecked()
})

// Tables shown, no toggle
test("the dashboard shows its numbers in tables", async ({ page }) => {
  await page.goto("/data")
  const table = page.locator("main table").first()
  await expect(table).toBeVisible()
  await expect(table.locator("tbody tr").first()).toBeVisible()
})

for (const width of [1024, 1280]) {
  test(`the issue filters fit the panel at ${width} px`, async ({
    page,
  }, info) => {
    test.skip(info.project.name === "phone", "desktop widths only")
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/isu")
    const fits = await page.evaluate(() => {
      const form = document.querySelector('form[action="/isu"]')
      const button = form?.querySelector('button[type="submit"]')
      const search = document.getElementById("issues-q")
      if (!form || !button || !search) return null
      const panel = form.getBoundingClientRect()
      const box = button.getBoundingClientRect()
      return {
        scroll: document.documentElement.scrollWidth <= window.innerWidth,
        inside: box.left >= panel.left && box.right <= panel.right,
        wide: search.getBoundingClientRect().width >= 240,
      }
    })
    expect(fits).toEqual({ scroll: true, inside: true, wide: true })
  })
}
