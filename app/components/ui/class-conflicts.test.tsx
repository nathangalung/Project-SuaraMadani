import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { Badge, type BadgeTone } from "./badge"
import { Button, ButtonLink } from "./button"
import { Card } from "./card"
import { Container } from "./container"
import { DateInput } from "./date-input"
import { Dialog } from "./dialog"
import { Checkbox, Fieldset, Radio, Textarea, TextInput } from "./field"
import { Note } from "./note"
import { Select } from "./select"
import { Table, Td, Th } from "./table"

// Same CSS property, one element
const GROUPS: [string, RegExp][] = [
  ["width", /^w-/],
  ["height", /^h-/],
  ["font-weight", /^font-(normal|medium|semibold|bold)$/],
  ["font-family", /^font-(body|heading|ui)$/],
  ["font-size", /^text-(xs|sm|base|lg|xl|\dxl)$/],
  [
    "text-color",
    /^text-(ink|ink-muted|ink-soft|accent|on-accent|danger|danger-ink|success|surface|surface-raised|mint|highlight)$/,
  ],
  ["background", /^bg-(?!clip)/],
  [
    "border-color",
    /^border-(line|line-subtle|danger|ink|accent|brand|success)$/,
  ],
  ["padding-x", /^px-/],
  ["padding-y", /^py-/],
]

function conflicts(html: string): string[] {
  const found: string[] = []
  for (const [, list] of html.matchAll(/class="([^"]*)"/g)) {
    const classes = (list ?? "").split(/\s+/).filter((c) => !c.includes(":"))
    for (const [name, pattern] of GROUPS) {
      const hits = classes.filter((c) => pattern.test(c))
      if (hits.length > 1) found.push(`${name}: ${hits.join(" ")}`)
    }
  }
  return found
}

function render(node: ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
}

describe("components emit no conflicting utilities", () => {
  const variants = [
    "primary",
    "highlight",
    "secondary",
    "quiet",
    "dark",
    "danger",
  ] as const
  const sizes = ["sm", "md", "lg"] as const
  const tones: BadgeTone[] = [
    "neutral",
    "soft",
    "brand",
    "ink",
    "success",
    "danger",
  ]
  const noteTones = ["neutral", "info", "success", "danger"] as const
  const cases: [string, () => ReactNode][] = [
    ...variants.flatMap((variant) =>
      sizes.map((size): [string, () => ReactNode] => [
        `button ${variant} ${size}`,
        () => (
          <>
            <Button variant={variant} size={size}>
              a
            </Button>
            <Button variant={variant} size={size} pending>
              a
            </Button>
            <ButtonLink to="/" variant={variant} size={size}>
              a
            </ButtonLink>
          </>
        ),
      ]),
    ),
    ...tones.map((tone): [string, () => ReactNode] => [
      `badge ${tone}`,
      () => <Badge tone={tone}>a</Badge>,
    ]),
    [
      "text input as heading with error",
      () => <TextInput id="a" label="A" error="x" labelAsHeading />,
    ],
    ["textarea with error", () => <Textarea id="b" label="B" error="x" />],
    [
      "select with error",
      () => (
        <Select id="c" label="C" error="x">
          <option>a</option>
        </Select>
      ),
    ],
    ...noteTones.map((tone): [string, () => ReactNode] => [
      `note ${tone}`,
      () => <Note tone={tone}>a</Note>,
    ]),
    [
      "date input with error",
      () => (
        <DateInput
          id="d"
          name="d"
          label="D"
          error="x"
          min="1900-01-01"
          max="2026-10-14"
          defaultValue="2026-10-14"
          requiredMark
        />
      ),
    ],
    [
      "cards, container, dialog",
      () => (
        <>
          <Card>a</Card>
          <Card variant="pastel">a</Card>
          <Card variant="inverse">a</Card>
          <Container width="4xl">a</Container>
          <Dialog open={false} onClose={() => {}} title="T" actions="a">
            a
          </Dialog>
        </>
      ),
    ],
    [
      "fieldset with choices",
      () => (
        <Fieldset id="e" legend="E" error="x" requiredMark>
          <Radio id="e1" name="e" value="1" label="1" />
          <Checkbox id="e2" name="f" value="2" label="2" />
        </Fieldset>
      ),
    ],
    [
      "table cells",
      () => (
        <Table caption="T">
          <thead>
            <tr>
              <Th numeric>a</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td numeric className="font-semibold">
                1
              </Td>
            </tr>
          </tbody>
        </Table>
      ),
    ],
  ]
  for (const [name, node] of cases) {
    test(name, () => {
      expect(conflicts(render(node()))).toEqual([])
    })
  }
})
