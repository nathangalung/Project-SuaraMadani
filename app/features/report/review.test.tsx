import { afterEach, describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub, MemoryRouter, Outlet } from "react-router"
import { m } from "~/paraglide/messages.js"
import { CONSENT_TEXT_VERSION } from "../../../shared/report-fields.ts"
import { type Draft, memory } from "./draft"
import {
  ConsentHint,
  ConsentRow,
  failureError,
  Review,
  SIGN_IN_TITLE_ID,
  Summary,
  serverErrors,
} from "./review"

const ID = "6f1c2b9e-0d4a-4c3b-9a8e-2f5d7c1b3a90"

function render(draft: Draft, signedInAs: string | null = "a@b.id") {
  const Stub = createRoutesStub([
    {
      path: "/lapor",
      Component: () => <Outlet context={{ paused: false }} />,
      children: [
        {
          path: "periksa",
          Component: () => (
            <Review
              draft={draft}
              today="2026-10-13"
              signedInAs={signedInAs}
              siteKey="k"
              operator="KM ITB"
              onSessionChange={() => {}}
            />
          ),
        },
      ],
    },
  ])
  return renderToStaticMarkup(<Stub initialEntries={["/lapor/periksa"]} />)
}

afterEach(() => {
  memory.files = []
})

describe("Review before submit", () => {
  test("an incomplete draft shows no errors until submit", () => {
    const html = render({ submissionId: ID })
    expect(html).not.toContain("border-danger")
    expect(html).not.toContain(m.field_error_prefix())
    expect(html).toContain("<title>Periksa dan Kirim</title>")
  })

  test("an attached device point is named, not shown", () => {
    const location = {
      provinceCode: "32",
      regencyCode: "32.73",
      districtCode: "32.73.02",
      label: "Coblong, Kota Bandung, Jawa Barat",
    }
    const html = render({
      submissionId: ID,
      location: { ...location, point: { lat: -6.89, lng: 107.61 } },
    })
    expect(html).toContain(m.review_point_attached())
    expect(html).not.toContain("107.61")
    const plain = render({ submissionId: ID, location })
    expect(plain).not.toContain(m.review_point())
  })

  test("photos lost on reload are named on the photo row", () => {
    const html = render({
      submissionId: ID,
      evidence: [{ name: "atap.jpg", size: 10, type: "image/jpeg" }],
    })
    const row = html.slice(
      html.indexOf('id="row-evidence"'),
      html.indexOf('id="row-contact"'),
    )
    expect(row).toContain(m.evidence_missing({ name: "atap.jpg" }))
    // Link lands on the picker
    expect(row).toMatch(
      /href="\/lapor\/bukti\?dari=periksa#evidence"[^>]*>Pilih lagi<span class="sr-only"> bukti<\/span>/,
    )
    expect(row).not.toContain(`>${m.review_change()}<`)
  })

  test("photo row keeps Ubah when nothing is lost", () => {
    const html = render({ submissionId: ID, evidence: [] })
    const row = html.slice(
      html.indexOf('id="row-evidence"'),
      html.indexOf('id="row-contact"'),
    )
    expect(row).toMatch(/href="\/lapor\/bukti\?dari=periksa"[^>]*>Ubah</)
  })

  test("emergency reports repeat the 112 banner", () => {
    expect(
      render({ submissionId: ID, details: { urgency: "emergency" } }),
    ).toContain("Hubungi 112")
    expect(render({ submissionId: ID })).not.toContain("Hubungi 112")
  })
})

describe("Review consent form", () => {
  const html = render({ submissionId: ID })

  test("consent title is a heading", () => {
    expect(html).toMatch(/<legend[^>]*><h2[^>]*>Persetujuan<\/h2><\/legend>/)
  })

  test("optional marker comes first", () => {
    expect(html).toContain(`${m.field_optional()} ${m.consent_forward()}`)
  })

  test("policies open in a new tab, boxes unchanged", () => {
    const hint = renderToStaticMarkup(<ConsentHint />)
    for (const [href, label] of [
      ["/privasi", "Kebijakan privasi"],
      ["/pedoman", "Pedoman konten"],
    ]) {
      expect(hint).toContain(
        `href="${href}" target="_blank" rel="noopener" class="font-semibold text-accent underline underline-offset-4 hover:no-underline">${label} <span class="whitespace-nowrap">(tab baru)</span></a>`,
      )
    }
    // Link outside every label
    expect(html).not.toMatch(/<label[^>]*>(?:(?!<\/label>).)*<a /)
    expect(html).toContain('href="/privasi"')
    expect(CONSENT_TEXT_VERSION).toBe("2026-10-13")
  })

  test("upload status region is mounted while idle", () => {
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/)
  })
})

describe("ConsentRow", () => {
  test("error sits below its box, no red bar", () => {
    const html = renderToStaticMarkup(
      <ConsentRow
        id="consent-accurate"
        name="accurate"
        label="Isi laporan ini benar"
        checked={false}
        error="Centang pernyataan ini"
        onChange={() => {}}
      />,
    )
    expect(html.indexOf("<input")).toBeGreaterThan(-1)
    expect(html.indexOf("<input")).toBeLessThan(
      html.indexOf("Centang pernyataan ini"),
    )
    expect(html).toMatch(/^<div>/)
    expect(html).not.toContain("border-l-4")
    expect(html).toContain('aria-describedby="consent-accurate-error"')
  })
})

describe("Review signed out", () => {
  test("sign-in heading can take focus", () => {
    const html = render({ submissionId: ID }, null)
    expect(html).toMatch(
      new RegExp(`<h2[^>]*id="${SIGN_IN_TITLE_ID}"[^>]*tabindex="-1"`),
    )
  })

  test("signed-out step 7 has no NIK line under sign-in", () => {
    const html = render({ submissionId: ID }, null)
    expect(html).not.toContain(m.signin_privacy_note())
    // Not inside the age label
    expect(html).not.toMatch(/<label[^>]*>(?:(?!<\/label>).)*<a /)
  })
})

describe("Summary", () => {
  test("row shows the same message as the error summary", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Summary
          draft={{ submissionId: ID }}
          errors={[{ fieldId: "row-location", message: "Pesan server" }]}
          missing={[]}
        />
      </MemoryRouter>,
    )
    const row = html.slice(html.indexOf('id="row-location"'))
    expect(row.slice(0, row.indexOf("</dl>"))).toContain("Pesan server")
  })
})

describe("serverErrors", () => {
  test("consent version points at the consent group", () => {
    expect(
      serverErrors([
        {
          path: "consent.consentTextVersion",
          key: "error_consent_version_outdated",
        },
      ]),
    ).toEqual([
      {
        fieldId: "consent-group",
        message: m.error_consent_version_outdated(),
      },
    ])
  })

  test("one entry per row, consent boxes keep their own", () => {
    expect(
      serverErrors([
        { path: "location.provinceCode", key: "error_province_required" },
        { path: "location.regencyCode", key: "error_regency_required" },
        {
          path: "consent.consents.accurate",
          key: "error_consent_accurate_required",
        },
      ]).map((error) => error.fieldId),
    ).toEqual(["row-location", "consent-accurate"])
  })

  test("a generic step error names the step", () => {
    expect(
      serverErrors([{ path: "details", key: "error_step_required" }]),
    ).toEqual([
      {
        fieldId: "row-details",
        message: m.error_step_incomplete({ step: m.step_details_title() }),
      },
    ])
  })
})

describe("failureError", () => {
  test("an ended session points at the sign-in form", () => {
    expect(failureError("sign_in_required")).toEqual({
      fieldId: SIGN_IN_TITLE_ID,
      message: m.error_sign_in_required(),
    })
    expect(failureError("quota_exceeded").fieldId).toBe("submit")
  })
})

describe("Review look", () => {
  const html = render({
    submissionId: ID,
    relation: { relation: "self" },
    contact: { contactable: "no" },
  })

  test("one section per step under the question h1", () => {
    expect(html.match(/<h1/g)?.length).toBe(1)
    for (const title of [
      m.step_relation_title(),
      m.step_location_title(),
      m.step_contact_title(),
    ]) {
      expect(html).toMatch(
        new RegExp(`<h2[^>]*>${title.replace("?", "\\?")}</h2>`),
      )
    }
  })

  test("every row keeps its own change link", () => {
    const rows = html.match(/<dt/g)?.length ?? 0
    const links = html.match(new RegExp(`>${m.review_change()}<`, "g"))?.length
    expect(rows).toBeGreaterThan(6)
    expect(links).toBe(rows)
  })

  test("info sits right above the submit button", () => {
    const info = html.indexOf(m.consent_info())
    const submit = html.indexOf('type="submit"')
    const captcha = html.indexOf('id="submit-captcha"')
    expect(captcha).toBeLessThan(info)
    expect(info).toBeLessThan(submit)
  })
})

describe("Review signed out panel", () => {
  test("sign-in sits on the white card, no tinted box or bar", () => {
    const html = render({ submissionId: ID }, null)
    const panel = html.slice(
      html.lastIndexOf("<section", html.indexOf(SIGN_IN_TITLE_ID)),
    )
    expect(panel).toMatch(/^<section[^>]*class="mt-8 flex flex-col gap-5"/)
    expect(html).not.toMatch(/bg-accent-soft|border-l-4/)
  })
})
