import { describe, expect, test } from "bun:test"
import routes from "../../routes"
import { isCurrent } from "./header"
import { footerNav, mainNav, policyNav } from "./site-nav"
import { bindDismiss, closeOutside } from "./use-dismiss"

const paths = new Set(
  routes.map((route) => (route.index ? "/" : `/${route.path}`)),
)

describe("site navigation", () => {
  test("main menu matches the agreed order", () => {
    expect(mainNav()).toEqual([
      { to: "/", label: "Beranda" },
      { to: "/lapor", label: "Lapor" },
      { to: "/isu", label: "Jelajahi Isu", also: ["/tuntutan"] },
      { to: "/data", label: "Dashboard" },
      { to: "/tentang", label: "Tentang" },
    ])
  })

  test("every menu and footer link has a route", () => {
    for (const item of [...mainNav(), ...footerNav(), ...policyNav()]) {
      const path = item.to.split("#")[0] ?? ""
      expect({ to: item.to, routed: paths.has(path) }).toEqual({
        to: item.to,
        routed: true,
      })
    }
  })

  test("Jelajahi Isu stays current on the Tuntutan tab", () => {
    const explore = mainNav().find((item) => item.to === "/isu")
    if (!explore) throw new Error("no /isu item")
    for (const path of [
      "/isu",
      "/isu/ISU-ITB-26-0001",
      "/tuntutan",
      "/tuntutan/TUN-ITB-26-0001",
    ]) {
      expect(isCurrent(explore, path)).toBe(true)
    }
    expect(isCurrent(explore, "/isuku")).toBe(false)
    expect(isCurrent({ to: "/", label: "Beranda" }, "/isu")).toBe(false)
  })

  test("footer adds tracking, home is the logo", () => {
    const footer = footerNav().map((item) => item.to)
    expect(footer).toEqual(["/lapor", "/isu", "/data", "/tentang", "/lacak"])
  })

  test("policy links match the page titles", () => {
    expect(policyNav()).toEqual([
      { to: "/privasi", label: "Kebijakan privasi" },
      { to: "/pedoman", label: "Pedoman konten" },
      // PLAN §6.1 footer
      { to: "/aksesibilitas", label: "Pernyataan aksesibilitas" },
      { to: "/tentang#lisensi", label: "Lisensi data dan kode" },
    ])
  })
})

type FakeMenu = { open: boolean; contains: (node: unknown) => boolean }

function fakeRoot(menus: FakeMenu[]) {
  return {
    querySelectorAll: () =>
      menus
        .filter((menu) => menu.open)
        .map((menu) => ({
          contains: menu.contains,
          removeAttribute: () => {
            menu.open = false
          },
        })),
  } as unknown as ParentNode
}

describe("menu dismiss", () => {
  test("closes menus the press landed outside", () => {
    const inside = {}
    const account = { open: true, contains: (n: unknown) => n === inside }
    const mobile = { open: true, contains: () => false }
    closeOutside(fakeRoot([account, mobile]), inside as Node)
    expect(account.open).toBe(true)
    expect(mobile.open).toBe(false)
  })

  test("navigation closes every menu", () => {
    const account = { open: true, contains: () => true }
    const mobile = { open: true, contains: () => true }
    closeOutside(fakeRoot([account, mobile]), null)
    expect([account.open, mobile.open]).toEqual([false, false])
  })

  test("focus leaving a menu closes it", () => {
    const handlers = new Map<string, (event: { target: unknown }) => void>()
    const doc = {
      addEventListener: (type: string, fn: () => void) =>
        handlers.set(type, fn),
      removeEventListener: (type: string) => handlers.delete(type),
    } as unknown as Pick<Document, "addEventListener" | "removeEventListener">
    const inside = {}
    const menu = { open: true, contains: (n: unknown) => n === inside }
    const unbind = bindDismiss(doc, () => fakeRoot([menu]))
    handlers.get("focusin")?.({ target: inside })
    expect(menu.open).toBe(true)
    handlers.get("focusin")?.({ target: {} })
    expect(menu.open).toBe(false)
    unbind()
    expect(handlers.size).toBe(0)
  })
})
