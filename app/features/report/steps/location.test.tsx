import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub, Outlet } from "react-router"
import { m } from "~/paraglide/messages.js"
import type { Draft, LocationAnswer } from "../draft"
import { LocationStep, type RegionLists } from "./location"

const ID = "6f1c2b9e-0d4a-4c3b-9a8e-2f5d7c1b3a90"
const LISTS: RegionLists = {
  provinces: [{ code: "32", name: "Jawa Barat" }],
  regencies: [{ code: "32.73", name: "Kota Bandung" }],
  districts: [],
  villages: [],
}

function render(location: LocationAnswer) {
  const draft: Draft = { submissionId: ID, location }
  const Stub = createRoutesStub([
    {
      path: "/lapor",
      Component: () => <Outlet context={{ paused: false }} />,
      children: [
        {
          path: "lokasi",
          Component: () => <LocationStep draft={draft} lists={LISTS} />,
        },
      ],
    },
  ])
  return renderToStaticMarkup(<Stub initialEntries={["/lapor/lokasi"]} />)
}

function placeholder(html: string, id: string): string {
  const select = html.match(
    new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`),
  )
  return select?.[0].match(/<option value=""[^>]*>([^<]*)</)?.[1] ?? ""
}

describe("locked region selects", () => {
  test("each locked select names the level above", () => {
    const html = render({})
    expect(placeholder(html, "provinceCode")).toBe(m.location_choose())
    expect(placeholder(html, "regencyCode")).toBe(
      m.location_choose_province_first(),
    )
    expect(placeholder(html, "districtCode")).toBe(
      m.location_choose_regency_first(),
    )
    expect(placeholder(html, "villageCode")).toBe(
      m.location_choose_district_first(),
    )
  })

  test("an open select just says choose", () => {
    const html = render({ provinceCode: "32" })
    expect(placeholder(html, "regencyCode")).toBe(m.location_choose())
    expect(placeholder(html, "districtCode")).toBe(
      m.location_choose_regency_first(),
    )
  })
})
