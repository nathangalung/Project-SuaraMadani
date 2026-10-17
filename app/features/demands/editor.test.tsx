import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { m } from "~/paraglide/messages.js"
import { outcome } from "./actions.server"
import {
  DraftPreview,
  demandErrors,
  ItemEditor,
  panelOf,
  StateForms,
} from "./editor-forms"
import type { ManagedDemand, ManagedItem } from "./manage.server"

const ITEM = "0190a000-0000-7000-8000-000000000001"

const item: ManagedItem = {
  id: ITEM,
  position: 0,
  body: "Sub-tuntutan pertama",
  briefSummary: "Ringkasan lama",
  version: 1,
  state: { response: "not_responded", fulfilment: "not_fulfilled" },
  briefs: [],
  updates: [],
}

const demand: ManagedDemand = {
  id: "0190a000-0000-7000-8000-000000000000",
  code: "TUN-ITB-26-0001",
  state: "published",
  version: 3,
  scope: "national",
  provinceCode: null,
  regencyCode: null,
  title: "Judul",
  body: "Teks",
  summary: "Ringkasan",
  target: "Kementerian",
  raisedOn: "2026-09-01",
  publishedAt: new Date("2026-09-02T03:00:00Z"),
  closedAt: null,
  hiddenAt: null,
  hiddenReason: null,
  frozen: false,
  items: [item],
  issues: [],
}

describe("editor errors", () => {
  test("publish without sub-tuntutan names the publish step", () => {
    expect(outcome("publish", { ok: false, reason: "no_items" })).toEqual({
      errors: ["publish_items"],
      intent: "publish",
    })
    expect(demandErrors(["publish_items"])).toEqual([
      { fieldId: "demand-publish", message: m.demand_publish_needs_items() },
    ])
  })

  test("an eleventh issue names the issue cap", () => {
    expect(outcome("link_issue", { ok: false, reason: "too_many" })).toEqual({
      errors: ["issues_too_many"],
      intent: "link_issue",
    })
    const [error] = demandErrors(["issues_too_many"])
    expect(error?.fieldId).toBe("issue-code")
    expect(error?.message).toContain("10 isu")
  })

  test("a date raised after the timeline is named", () => {
    expect(
      outcome("edit", { ok: false, reason: "raised_after_updates" }),
    ).toEqual({ errors: ["raised_after_updates"], intent: "edit" })
    expect(demandErrors(["raised_after_updates"])[0]?.fieldId).toBe(
      "demand-raised-on",
    )
  })
})

describe("failed item forms", () => {
  test("each intent opens its own panel", () => {
    expect(panelOf("update_item")).toBe("catat")
    expect(panelOf("edit_item")).toBe("ubah")
    expect(panelOf("edit_brief")).toBe("brief")
    expect(panelOf("publish_brief")).toBe("brief")
    expect(panelOf("withdraw_brief")).toBe("brief")
    expect(panelOf("move_up")).toBeNull()
  })

  function render(
    open: ReturnType<typeof panelOf>,
    values = {},
    shown: ManagedDemand = demand,
  ) {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <ol>
            <ItemEditor
              demand={shown}
              item={item}
              index={0}
              errors={[]}
              today="2026-10-17"
              open={open}
              values={values}
            />
          </ol>
        ),
      },
    ])
    return renderToStaticMarkup(<Stub initialEntries={["/"]} />)
  }

  const openPanels = (html: string) =>
    [...html.matchAll(/<details[^>]*id="([a-z]+)-[^"]*"[^>]*open=""/g)].map(
      (match) => match[1],
    )

  test("the text form opens alone and keeps the typed text", () => {
    const html = render("ubah", { body: "Teks yang diketik" })
    expect(openPanels(html)).toEqual(["ubah"])
    expect(html).toContain("Teks yang diketik")
  })

  test("the brief summary sits in the brief panel", () => {
    const html = render("brief", { briefSummary: "Ringkasan baru" })
    expect(openPanels(html)).toEqual(["brief"])
    const brief = html.slice(html.indexOf('id="brief-'))
    expect(brief.indexOf('name="briefSummary"')).toBeGreaterThan(-1)
    expect(brief.indexOf('name="briefSummary"')).toBeLessThan(
      brief.indexOf('id="ubah-'),
    )
    expect(html).toContain("Ringkasan baru")
  })

  test("a hidden, closed tuntutan offers no update, upload or remove", () => {
    const hidden: ManagedDemand = {
      ...demand,
      state: "draft",
      hiddenAt: new Date("2026-10-10T03:00:00Z"),
      frozen: true,
    }
    const html = render(null, {}, hidden)
    expect(html).not.toContain('id="catat-')
    expect(html).not.toContain('name="brief"')
    expect(html).not.toContain('value="remove_item"')
    // A never published draft can
    const draft = render(
      null,
      {},
      { ...demand, state: "draft", publishedAt: null },
    )
    expect(draft).toContain('value="remove_item"')
    expect(draft).toContain('name="brief"')
  })
})

describe("closed refusals", () => {
  test("say the tuntutan is closed, not a stale page", () => {
    expect(outcome("add_item", { ok: false, reason: "closed" })).toEqual({
      errors: ["demand_closed"],
      intent: "add_item",
    })
    expect(demandErrors(["demand_closed"])).toEqual([
      { fieldId: "demand-state", message: m.demand_error_closed() },
    ])
  })
})

describe("brief upload", () => {
  test("the file control is styled like the logo upload", () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <ol>
            <ItemEditor
              demand={demand}
              item={item}
              index={0}
              errors={[]}
              today="2026-10-17"
              open="brief"
            />
          </ol>
        ),
      },
    ])
    const html = renderToStaticMarkup(<Stub initialEntries={["/"]} />)
    const input = /<input[^>]*name="brief"[^>]*>/.exec(html)?.[0] ?? ""
    expect(input).toContain("file:font-ui")
    expect(input).not.toContain("h-12")
  })
})

describe("save feedback", () => {
  test("a saved or unchanged item form names its item", () => {
    const done = { ok: true, code: demand.code } as const
    expect(outcome("update_item", done, ITEM)).toEqual({
      saved: "update_item",
      itemId: ITEM,
    })
    expect(outcome("publish", done)).toEqual({ saved: "publish" })
    expect(
      outcome("edit_item", { ok: false, reason: "unchanged" }, ITEM),
    ).toEqual({ unchanged: true, intent: "edit_item", itemId: ITEM })
  })

  function editor(
    index: number,
    items: ManagedItem[],
    notice?: string,
    spot: "head" | "catat" = "head",
  ) {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <ol>
            <ItemEditor
              demand={{ ...demand, items }}
              item={items[index] ?? item}
              index={index}
              errors={[]}
              today="2026-10-17"
              open={null}
              notice={
                notice
                  ? { notice: { tone: "success", text: notice }, at: spot }
                  : null
              }
            />
          </ol>
        ),
      },
    ])
    return renderToStaticMarkup(<Stub initialEntries={["/"]} />)
  }

  test("the notice sits inside the item that was saved", () => {
    const html = editor(0, [item], "Pembaruan dicatat.")
    const at = html.indexOf('role="status"')
    expect(at).toBeGreaterThan(html.indexOf(`id="sub-${ITEM}"`))
    expect(at).toBeLessThan(html.indexOf("</li>"))
    expect(html).toContain("Pembaruan dicatat.")
    expect(editor(0, [item])).not.toContain('role="status"')
    // Panel notice after its form
    const saved = editor(0, [item], "Pembaruan dicatat.", "catat")
    const panel = saved.slice(saved.indexOf(`id="catat-${ITEM}"`))
    expect(/^id="catat-[^"]*"[^>]*open=""/.test(panel)).toBe(true)
    const status = panel.indexOf('role="status"')
    expect(status).toBeGreaterThan(panel.indexOf('value="update_item"'))
    expect(status).toBeLessThan(panel.indexOf("</details>"))
  })

  test("an edge arrow stays focusable", () => {
    const second = { ...item, id: `${ITEM.slice(0, -1)}2`, position: 1 }
    const first = editor(0, [item, second])
    const up = /<button[^>]*value="move_up"[^>]*>/.exec(first)?.[0] ?? ""
    expect(up).toContain('aria-disabled="true"')
    expect(up).not.toMatch(/\sdisabled=""/)
    const down = /<button[^>]*value="move_down"[^>]*>/.exec(first)?.[0] ?? ""
    expect(down).not.toContain('aria-disabled="')
  })
})

describe("publishing a draft", () => {
  const draft: ManagedDemand = { ...demand, state: "draft", publishedAt: null }
  function html(node: ReactNode) {
    const Stub = createRoutesStub([{ path: "/", Component: () => node }])
    return renderToStaticMarkup(<Stub initialEntries={["/"]} />)
  }

  test("the public text shows before the publish step", () => {
    const out = html(<DraftPreview demand={draft} />)
    for (const text of ["Ringkasan", "Teks", "Kementerian"]) {
      expect(out).toContain(text)
    }
    expect(out).toContain(m.demand_draft_preview_title())
  })

  test("publishing takes a second, deliberate click", () => {
    const closed = html(<StateForms demand={draft} errors={[]} />)
    const panel = /<details[^>]*id="terbitkan"[^>]*>/.exec(closed)?.[0] ?? ""
    expect(panel).not.toContain("open")
    expect(closed.indexOf('value="publish"')).toBeGreaterThan(
      closed.indexOf('id="terbitkan"'),
    )
    const failed = html(
      <StateForms demand={draft} errors={demandErrors(["publish_items"])} />,
    )
    expect(/<details[^>]*id="terbitkan"[^>]*>/.exec(failed)?.[0]).toContain(
      'open=""',
    )
  })
})
