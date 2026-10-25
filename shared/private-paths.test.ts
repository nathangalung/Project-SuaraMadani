import { describe, expect, test } from "bun:test"
import { isPrivatePath, scrubTrackerPayload } from "./private-paths.ts"

describe("isPrivatePath", () => {
  test.each([
    "/lapor",
    "/lapor/sukses/ITB-26-7K3QX",
    "/lacak",
    "/masuk",
    "/aduan/ADU-1",
    "/undangan/abc",
    "/isu/ISU-ITB-26-0001/laporkan",
    "/isu/ISU-ITB-26-0001/berhenti",
    "/isu/ISU-ITB-26-0001/nilai",
    "/isu/ISU-ITB-26-0001/survei",
    "/isu/ISU-ITB-26-0001/hak-jawab",
    "/tuntutan/TUN-ITB-26-0001/laporkan",
    "/tuntutan/TUN-ITB-26-0001/nilai",
    "/tuntutan/TUN-ITB-26-0001/berhenti",
    "/kelola/antrean",
    "/admin",
    "/api/upload/x",
    "/healthz",
  ])("%s is private", (path) => {
    expect(isPrivatePath(path)).toBe(true)
  })

  test.each([
    "/",
    "/isu",
    "/isu/ISU-ITB-26-0001",
    "/tuntutan",
    "/data",
    "/tentang",
    "/api/v1/data",
    "/laporan",
  ])("%s is public", (path) => {
    expect(isPrivatePath(path)).toBe(false)
  })
})

describe("scrubTrackerPayload", () => {
  const view = { website: "w", url: "/", referrer: "", title: "Beranda" }

  test.each(["event", "performance", "identify"])(
    "%s drops a private referrer",
    (type) => {
      const out = scrubTrackerPayload(type, {
        ...view,
        referrer: "/lapor/sukses/ITB-26-7K3QX",
        lcp: 1200,
      })
      expect(out).toEqual({ ...view, referrer: "", lcp: 1200 })
    },
  )

  test.each([
    "https://ugm.sadarbersuara.id/aduan/ADU-1",
    "/isu/ISU-ITB-26-0001/hak-jawab",
    "/kelola/antrean",
  ])("referrer %s is dropped", (referrer) => {
    const payload: typeof view = { ...view, referrer }
    expect(scrubTrackerPayload("event", payload)).toEqual(view)
  })

  test.each(["/lapor/sukses/ITB-26-7K3QX", "/kelola", "https://itb.x/lacak"])(
    "a view of %s is never sent",
    (url) => {
      expect(scrubTrackerPayload("event", { ...view, url })).toBeNull()
      expect(scrubTrackerPayload("performance", { ...view, url })).toBeNull()
    },
  )

  test("public pages pass unchanged", () => {
    const payload = {
      ...view,
      url: "/isu/ISU-ITB-26-0001",
      referrer: "https://www.google.com/",
    }
    expect(scrubTrackerPayload("event", payload)).toBe(payload)
    expect(scrubTrackerPayload("event", { ...view, referrer: "/isu" })).toEqual(
      { ...view, referrer: "/isu" },
    )
  })

  test("Given a URL that does not parse, when it is sent, then it is dropped, never forwarded", () => {
    const broken = "http://[itb/lacak/ITB-26-7K3QX"
    expect(scrubTrackerPayload("event", { ...view, url: broken })).toBeNull()
    expect(scrubTrackerPayload("event", { ...view, referrer: broken })).toEqual(
      view,
    )
  })

  test("a null payload stays null", () => {
    expect(scrubTrackerPayload("event", null)).toBeNull()
  })
})
