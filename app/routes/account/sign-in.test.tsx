import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub, RouterContextProvider } from "react-router"
import { m } from "~/paraglide/messages.js"
import { sessionContext } from "../../context.ts"
import SignInPage, { loader } from "./sign-in"

type Props = Parameters<typeof SignInPage>[0]

function render(
  signedInAs: string | null,
  next: string | null = null,
  extra: { needsPhone?: boolean; actionData?: unknown; signUp?: boolean } = {},
) {
  const props = {
    loaderData: {
      siteKey: "k",
      signedInAs,
      next,
      needsPhone: extra.needsPhone ?? false,
      signUp: extra.signUp ?? false,
    },
    actionData: extra.actionData,
  } as unknown as Props
  const Stub = createRoutesStub([
    { path: "/masuk", Component: () => <SignInPage {...props} /> },
  ])
  return renderToStaticMarkup(<Stub initialEntries={["/masuk"]} />)
}

describe("/masuk flow", () => {
  test("says why to sign in and points new people to Daftar", () => {
    const html = render(null)
    expect(html).toContain(m.signin_page_intro())
    expect(html).not.toContain(m.signin_intro())
    expect(m.signin_page_intro()).toContain("status laporan")
    expect(m.signin_page_intro()).toContain("Daftar")
    expect(html).toContain(`>${m.signin_page_heading()}</h1>`)
    expect(html).toContain(`>${m.signin_tab_up()}</button>`)
    // NIK line removed 22 Oct
    expect(html).not.toContain(m.signin_privacy_note())
  })

  test("home Buat akun opens Daftar", async () => {
    const context = new RouterContextProvider()
    context.set(sessionContext, null)
    const data = await loader({
      request: new Request("http://itb.localhost/masuk?daftar=1"),
      context,
    } as unknown as Parameters<typeof loader>[0])
    expect(data.signUp).toBe(true)
    expect(render(null)).not.toContain('name="phone"')
    const html = render(null, null, { signUp: data.signUp })
    expect(html).toContain('name="phone"')
    expect(html).toContain(m.signin_age())
    // Every Daftar field is marked
    expect(
      html.match(/aria-hidden="true" class="ml-0.5 text-danger">\*/g),
    ).toHaveLength(4)
    expect(html).toContain(m.field_required_note())
  })

  test("signed in, one next step plus switching email", () => {
    const html = render("cb10-warga@contoh.id")
    const card = html.slice(
      html.indexOf("<h1"),
      html.indexOf(m.signin_privacy_note()),
    )
    expect(card.match(/href="/g)?.length).toBe(1)
    expect(card).toMatch(/href="\/lacak"[^>]*>Laporan saya</)
    // Signs out back to /masuk
    expect(card).toContain('<form action="/keluar" method="post">')
    expect(card).toContain('<input type="hidden" name="next" value="/masuk"/>')
    expect(card).toContain(`>${m.signin_switch_email()}</button>`)
  })

  test("signed-in email never splits at its hyphen", () => {
    const html = render("cb10-warga@contoh.id")
    expect(html).toContain(
      '<span class="inline-block max-w-full break-all">cb10-warga@contoh.id.</span>',
    )
    expect(String(m.signin_signed_in({ email: "a@b.id" }))).toBe(
      "Anda masuk sebagai a@b.id.",
    )
  })

  test("a tuntutan follow returns to its tuntutan", async () => {
    const context = new RouterContextProvider()
    context.set(sessionContext, null)
    const data = await loader({
      request: new Request(
        "http://itb.localhost/masuk?kembali=%2Ftuntutan%2FTUN-ITB-26-0003",
      ),
      context,
    } as unknown as Parameters<typeof loader>[0])
    expect(data.next).toBe("/tuntutan/TUN-ITB-26-0003")
    const html = render("warga@contoh.id", data.next)
    expect(html).toMatch(/href="\/tuntutan\/TUN-ITB-26-0003"[^>]*>Lanjutkan</)
  })

  test("an account without a number is asked for one", async () => {
    const context = new RouterContextProvider()
    context.set(sessionContext, {
      user: { email: "dilepas@contoh.id", phoneNumber: null },
    } as never)
    // Return path skips staff lookup
    const data = await loader({
      request: new Request("http://itb.localhost/masuk?kembali=%2Flacak"),
      context,
    } as unknown as Parameters<typeof loader>[0])
    expect(data.needsPhone).toBe(true)
    const html = render("dilepas@contoh.id", null, { needsPhone: true })
    expect(html).toContain(`>${m.signin_phone_title()}</h2>`)
    expect(html).toContain('name="intent" value="add_phone"')
    expect(html).toContain('name="phone"')
    expect(render("warga@contoh.id")).not.toContain(m.signin_phone_title())
  })

  test("a refused number says why on the field", () => {
    const html = render("dilepas@contoh.id", null, {
      needsPhone: true,
      actionData: { error: "taken" },
    })
    expect(html).toContain(m.error_phone_add_taken())
    expect(
      render("dilepas@contoh.id", null, { actionData: { saved: true } }),
    ).toContain(m.signin_phone_saved())
  })
})
