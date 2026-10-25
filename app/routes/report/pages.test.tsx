import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { hasPageSignIn } from "~/components/layout/header"
import { m } from "~/paraglide/messages.js"
import ReportLayout from "./layout"
import { handle as reviewHandle } from "./review"
import Success from "./success"

type LayoutProps = Parameters<typeof ReportLayout>[0]
type SuccessProps = Parameters<typeof Success>[0]

describe("report layout", () => {
  function render(handle: unknown, child = () => <p>Isi</p>) {
    const Stub = createRoutesStub([
      {
        path: "/lapor",
        Component: () => (
          <ReportLayout
            {...({
              loaderData: { paused: false },
            } as unknown as LayoutProps)}
          />
        ),
        children: [{ path: "x", Component: child, handle }],
      },
    ])
    return renderToStaticMarkup(<Stub initialEntries={["/lapor/x"]} />)
  }

  test("bookmarked success page has no JS notice", () => {
    expect(render({ reportStep: null })).not.toContain("<noscript>")
  })

  test("toast region is mounted for the copy button", () => {
    for (const handle of [{ reportStep: null }, { reportStep: "details" }]) {
      const layout = render(handle)
      expect(layout).toMatch(/<div role="status" aria-live="polite"/)
      // Last control clears the toast
      expect(layout).toContain("pb-24")
      expect(layout).toContain("sm:pb-10")
    }
  })

  test("step pages get the list, success gets neither", () => {
    const step = render({ reportStep: "details" })
    expect(step).toContain(`aria-label="${m.report_steps_label()}"`)
    expect(step).toContain(m.report_draft_note())
    const success = render({ reportStep: null })
    expect(success).not.toContain(m.report_steps_label())
    expect(success).not.toContain(m.report_draft_note())
  })

  test("lead shows on steps only", () => {
    const step = render({ reportStep: "relation" })
    expect(step).toContain(m.report_lead())
    // Age asked at sign-in
    expect(m.report_lead()).not.toContain("18 tahun")
    expect(render({ reportStep: null })).not.toContain(m.report_lead())
  })

  test("review owns the sign-in, header drops it", () => {
    expect(hasPageSignIn(reviewHandle)).toBe(true)
  })

  test("page title is not the h1, the question is", () => {
    const step = render({ reportStep: "details" })
    expect(step).not.toContain("<h1")
    expect(step).toContain(m.report_title())
  })
})

describe("success page", () => {
  function render(state: unknown, signedIn = false) {
    const Stub = createRoutesStub([
      {
        path: "/lapor/sukses/:code",
        Component: () => (
          <Success
            {...({
              loaderData: {
                code: "LPR-2026-10-0001",
                tenant: "KM ITB",
                campus: "Institut Teknologi Bandung",
                signedIn,
              },
            } as unknown as SuccessProps)}
          />
        ),
      },
    ])
    return renderToStaticMarkup(
      <Stub
        initialEntries={[{ pathname: "/lapor/sukses/LPR-2026-10-0001", state }]}
      />,
    )
  }

  test("failed photos notice sits in the page flow", () => {
    const html = render({ filesFailed: true })
    expect(html).toContain(m.success_files_failed())
    expect(html).not.toContain('role="status"')
  })

  test("copy button space is reserved before hydration", () => {
    const html = render(null)
    expect(html).toContain('<div class="mt-4 h-9 print:hidden"></div>')
    expect(html).not.toContain(m.success_copy())
  })

  test("emergency reports repeat the 112 banner", () => {
    expect(render({ emergency: true })).toContain("Hubungi 112")
    expect(render(null)).not.toContain("Hubungi 112")
  })

  test("label shows code and campus, date only on arrival", () => {
    const fresh = render({ sentAt: "2026-10-14T03:00:00.000Z" })
    expect(fresh).toContain("<figcaption")
    expect(fresh).toContain(m.report_label_campus())
    expect(fresh).toContain(m.report_label_sent())
    expect(fresh).toContain("14 Oktober 2026")
    const bookmark = render(null)
    expect(bookmark).toContain("LPR-2026-10-0001")
    expect(bookmark).not.toContain(m.report_label_sent())
    // Status goes stale, never shown
    expect(bookmark).not.toContain(`>${m.report_status_submitted()}<`)
  })

  test("no usual check time promise", () => {
    // Removed 25 Oct
    expect(render(null)).not.toContain("Biasanya")
  })

  test("contact line, saved as PDF after hydration", () => {
    const html = render(null)
    expect(html).toContain(m.success_contact_lead())
    // Print needs JS, never dead
    expect(html).not.toContain(m.success_print())
  })

  test("three next steps, then one exit", () => {
    const html = render(null)
    const list = html.slice(html.indexOf("<ol"), html.indexOf("</ol>"))
    expect(list.match(/<li/g)?.length).toBe(3)
    expect(list).toContain(m.success_next_body())
    expect(list).toContain(m.success_next_merge_body())
    // Numbered in round circles
    expect(
      list.match(
        /<span aria-hidden="true" class="[^"]*rounded-full[^"]*">\d<\/span>/g,
      )?.length,
    ).toBe(3)
    // Title above body, top aligned
    expect(list.match(/<li class="flex items-start gap-4"/g)?.length).toBe(3)
    const titles = [
      m.success_next_check(),
      m.success_next_merge(),
      m.success_next_follow(),
    ]
    for (const title of titles) {
      expect(list).toContain(`<p class="font-semibold text-lg">${title}</p>`)
    }
    expect(list.indexOf(m.success_next_check())).toBeLessThan(
      list.indexOf(m.success_next_body()),
    )
    expect(html).toMatch(/href="\/lacak"[^>]*>Laporan saya</)
    // One next step, not two
    expect(html).not.toContain('href="/isu"')
    expect(html.match(/<h1/g)?.length).toBe(1)
  })

  test("status access is said once, fitting the session", () => {
    const lead = m.success_code_note()
    expect(lead).not.toContain("status")
    const signedOut = render(null)
    expect(signedOut).toContain(lead)
    expect(signedOut).toContain(m.success_next_body())
    const signedIn = render(null, true)
    expect(signedIn).toContain(m.success_next_body_signed_in())
    // Arriving user already signed in
    expect(signedIn).not.toContain("setelah Anda masuk")
  })
})
