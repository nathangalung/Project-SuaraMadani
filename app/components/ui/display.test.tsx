import { describe, expect, test } from "bun:test"
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { m } from "~/paraglide/messages.js"
import { Badge } from "./badge"
import { Button } from "./button"
import { Card } from "./card"
import { Container } from "./container"
import { backdropClose, Dialog } from "./dialog"
import { Skeleton } from "./skeleton"
import { Table, Td, Th } from "./table"

describe("Dialog", () => {
  test("is a native dialog named by its heading", () => {
    const html = renderToStaticMarkup(
      <Dialog open={false} onClose={() => {}} title="Gabungkan Laporan">
        <p>Isi</p>
      </Dialog>,
    )
    const labelledBy = html.match(/<dialog[^>]*aria-labelledby="([^"]+)"/)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(html).toContain(`<h2 id="${labelledBy}"`)
    expect(html).not.toMatch(/<dialog[^>]*\sopen/)
  })

  test("floats with a blurred backdrop, padding inside", () => {
    const html = renderToStaticMarkup(
      <Dialog open={false} onClose={() => {}} title="Kirim?">
        <p>Isi</p>
      </Dialog>,
    )
    const dialog = html.match(/<dialog[^>]*>/)?.[0] ?? ""
    for (const name of [
      "rounded-xl",
      "p-0",
      "shadow-floating",
      "backdrop:bg-ink/40",
      "backdrop:backdrop-blur-[2px]",
    ]) {
      expect(dialog).toContain(name)
    }
  })

  test("backdrop closes only when allowed and only on the backdrop", () => {
    let closed = 0
    const dialog = { close: () => closed++ }
    backdropClose(false)({ target: dialog, currentTarget: dialog })
    expect(closed).toBe(0)
    backdropClose(true)({ target: {}, currentTarget: dialog })
    expect(closed).toBe(0)
    backdropClose(true)({ target: dialog, currentTarget: dialog })
    expect(closed).toBe(1)
  })
})

describe("Button", () => {
  test("pending keeps focus, blocks clicks, shows a spinner", () => {
    let clicks = 0
    let prevented = 0
    const element = Button({
      type: "submit",
      pending: true,
      onClick: () => clicks++,
      children: "Kirim",
    }) as ReactElement<{ onClick: (event: unknown) => void }>
    element.props.onClick({ preventDefault: () => prevented++ })
    expect(clicks).toBe(0)
    expect(prevented).toBe(1)
    const html = renderToStaticMarkup(element)
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/)
    expect(html).toMatch(/<svg[^>]*pending-spinner[^>]*aria-hidden="true"/)
  })

  test("pending swaps the label for busy text", () => {
    const own = renderToStaticMarkup(
      <Button pending pendingLabel="Mengirim kode…">
        Kirim
      </Button>,
    )
    expect(own).toContain("Mengirim kode…")
    expect(own).not.toContain("Kirim<")
    const fallback = renderToStaticMarkup(<Button pending>Simpan</Button>)
    expect(fallback).toContain(m.button_pending())
    expect(fallback).not.toContain("Simpan")
    const idle = renderToStaticMarkup(
      <Button pendingLabel="Mengirim kode…">Kirim</Button>,
    )
    expect(idle).toContain("Kirim")
    expect(idle).not.toContain("Mengirim kode…")
  })

  test("a pending press does not move", () => {
    const html = renderToStaticMarkup(<Button pending>Kirim</Button>)
    expect(html).toContain("aria-disabled:active:translate-y-0")
  })

  test("idle buttons pass clicks through", () => {
    let clicks = 0
    const element = Button({
      onClick: () => clicks++,
      children: "Simpan",
    }) as ReactElement<{ onClick: (event: unknown) => void }>
    element.props.onClick({ preventDefault: () => {} })
    expect(clicks).toBe(1)
    const html = renderToStaticMarkup(element)
    expect(html).not.toContain('aria-disabled="')
    expect(html).not.toContain("<svg")
  })

  test("press, disabled and quiet follow the mockup", () => {
    const html = renderToStaticMarkup(<Button variant="quiet">Hapus</Button>)
    expect(html).toContain("active:translate-y-0.5")
    expect(html).toContain("disabled:opacity-50")
    const classes = html.match(/class="([^"]*)"/)?.[1]?.split(" ")
    expect(classes).not.toContain("underline")
  })
})

describe("Table", () => {
  test("has a caption, scoped headers and right-aligned numbers", () => {
    const html = renderToStaticMarkup(
      <Table caption="Laporan per Kategori">
        <thead>
          <tr>
            <Th>Kategori</Th>
            <Th numeric>Jumlah</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Th scope="row">Bansos</Th>
            <Td numeric>12.481</Td>
          </tr>
        </tbody>
      </Table>,
    )
    expect(html).toContain("<caption")
    expect(html).toContain('scope="col"')
    expect(html).toContain('scope="row"')
    expect(html).toMatch(/<td[^>]*text-right[^>]*>12\.481<\/td>/)
    // A range never splits
    expect(html).toMatch(/<td[^>]*whitespace-nowrap[^>]*>12\.481<\/td>/)
    expect(html).toMatch(/<section aria-labelledby="[^"]+" tabindex="0"/)
  })
})

describe("Badge", () => {
  test("uses theme tones", () => {
    expect(
      renderToStaticMarkup(<Badge tone="success">Selesai</Badge>),
    ).toContain("bg-success")
    expect(renderToStaticMarkup(<Badge>Dipantau</Badge>)).toContain("bg-chip")
    expect(renderToStaticMarkup(<Badge tone="soft">Baru</Badge>)).toContain(
      "bg-accent-soft text-accent",
    )
  })
})

describe("Card", () => {
  test("raised card has a border and no shadow", () => {
    const html = renderToStaticMarkup(<Card>Isi</Card>)
    expect(html).toContain("border")
    expect(html).not.toContain("shadow")
  })

  test("inverse card uses raised text on ink", () => {
    expect(renderToStaticMarkup(<Card variant="inverse">Isi</Card>)).toContain(
      "bg-ink text-surface-raised",
    )
  })
})

describe("Container", () => {
  test("one max width per container", () => {
    const html = renderToStaticMarkup(<Container width="3xl">Isi</Container>)
    expect(html.match(/max-w-\w+/g)).toEqual(["max-w-3xl"])
    expect(renderToStaticMarkup(<Container>Isi</Container>)).toContain(
      "max-w-6xl",
    )
  })
})

describe("Skeleton", () => {
  test("is hidden from assistive technology", () => {
    expect(renderToStaticMarkup(<Skeleton className="h-4 w-32" />)).toBe(
      '<div aria-hidden="true" class="animate-pulse bg-ink/8 noscript:hidden h-4 w-32"></div>',
    )
  })
})
