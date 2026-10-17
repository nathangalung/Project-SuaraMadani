import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { m } from "~/paraglide/messages.js"
import {
  ChannelChoice,
  type ChannelOptions,
  channelFocusId,
  openChannels,
} from "./channel-choice"
import {
  CodeForm,
  checkNewError,
  clockText,
  codeDigits,
  insertedWholeCode,
  lookupError,
  pasteCode,
  RESEND_SECONDS,
  ResendCode,
  SignIn,
  secondsLeft,
  sendMessage,
  signInProblem,
  signUpProblems,
  valuesFrom,
  verifyMessage,
  whatsappFailedNotice,
} from "./sign-in"

describe("SignIn before hydration", () => {
  const html = renderToStaticMarkup(
    <SignIn siteKey="k" onSignedIn={() => {}} />,
  )

  test("server HTML cannot be submitted", () => {
    const fieldset = html.indexOf("<fieldset disabled")
    expect(fieldset).toBeGreaterThan(-1)
    expect(fieldset).toBeLessThan(html.indexOf('name="identifier"'))
    expect(fieldset).toBeLessThan(html.indexOf('type="submit"'))
  })

  test("status region is mounted before any message", () => {
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/)
  })

  test("two clear paths, Masuk first with one identifier field", () => {
    expect(html).toContain(`aria-pressed="true"`)
    expect(html.indexOf(m.signin_tab_in())).toBeLessThan(
      html.indexOf(m.signin_tab_up()),
    )
    expect(html).toContain(m.signin_identifier_label())
    expect(html).toContain('autoComplete="username"')
    expect(html).not.toContain('name="phone"')
    expect(html).not.toContain(m.signin_age())
  })

  test("Daftar asks name, email, WhatsApp and the unchecked box", () => {
    const signUp = renderToStaticMarkup(
      <SignIn siteKey="k" onSignedIn={() => {}} initialMode="sign-up" />,
    )
    for (const name of ["name", "email", "phone", "age"]) {
      expect(signUp).toContain(`name="${name}"`)
    }
    expect(signUp).toContain('autoComplete="tel"')
    expect(signUp).toContain(m.signin_age())
    expect(signUp).not.toMatch(/name="age"[^>]*checked/)
  })
})

describe("SignIn page heading", () => {
  test("the page H1 sits inside the form, before the intro", () => {
    const html = renderToStaticMarkup(
      <SignIn
        siteKey="k"
        onSignedIn={() => {}}
        heading={{
          start: <h1>Masuk</h1>,
          channel: <h1>Kirim</h1>,
          code: () => <h1>Kode</h1>,
        }}
      />,
    )
    const h1 = html.indexOf("<h1>Masuk</h1>")
    expect(h1).toBeGreaterThan(html.indexOf("<fieldset"))
    expect(h1).toBeLessThan(html.indexOf(m.signin_intro()))
    expect(html).not.toContain("<h1>Kode</h1>")
  })

  test("step 7 keeps its own heading level", () => {
    const html = renderToStaticMarkup(
      <SignIn siteKey="k" onSignedIn={() => {}} />,
    )
    expect(html).not.toContain("<h1")
  })

  test("/masuk submits look primary and full width, step 7 dark", () => {
    const submit = (html: string) =>
      html.match(/<button type="submit" class="([^"]*)"/)?.[1] ?? ""
    const page = submit(
      renderToStaticMarkup(
        <SignIn siteKey="k" onSignedIn={() => {}} primary />,
      ),
    )
    expect(page).toContain("bg-brand")
    expect(page).toContain("w-full")
    expect(page).not.toContain("sm:w-auto")
    const step7 = submit(
      renderToStaticMarkup(<SignIn siteKey="k" onSignedIn={() => {}} />),
    )
    expect(step7).toContain("bg-ink")
    const code = (primary: boolean) =>
      submit(
        renderToStaticMarkup(
          <CodeForm
            channel="email"
            to="a•••@b.id"
            errors={[]}
            busy={false}
            onSubmit={() => {}}
            onBack={() => {}}
            primary={primary}
          />,
        ),
      )
    expect(code(true)).toContain("bg-brand")
    expect(code(false)).toContain("bg-ink")
  })

  test("the code heading follows the error summary", () => {
    const html = renderToStaticMarkup(
      <CodeForm
        channel="email"
        to="a•••@b.id"
        errors={[{ fieldId: "signin-code", message: "Kode salah" }]}
        busy={false}
        onSubmit={() => {}}
        onBack={() => {}}
        heading={<h1>Periksa</h1>}
      />,
    )
    expect(html.indexOf("Kode salah")).toBeLessThan(
      html.indexOf("<h1>Periksa</h1>"),
    )
    expect(html.indexOf("<h1>Periksa</h1>")).toBeLessThan(
      html.indexOf('name="code"'),
    )
  })

  test("the hint names the channel and the masked destination", () => {
    const html = (channel: "email" | "whatsapp", to: string) =>
      renderToStaticMarkup(
        <CodeForm
          channel={channel}
          to={to}
          errors={[]}
          busy={false}
          onSubmit={() => {}}
          onBack={() => {}}
        />,
      )
    expect(html("whatsapp", "+62 812•••••890")).toContain(
      m.signin_code_hint_whatsapp({ to: "+62 812•••••890" }),
    )
    expect(html("email", "a•••@b.id")).toContain(
      m.signin_code_hint({ to: "a•••@b.id" }),
    )
  })
})

const whatsappInput = (html: string) =>
  html.match(/<input id="signin-channel-whatsapp"[^>]*>/)?.[0] ?? ""

describe("ChannelChoice", () => {
  const render = (props: Partial<Parameters<typeof ChannelChoice>[0]> = {}) =>
    renderToStaticMarkup(
      <ChannelChoice
        email={{ kind: "masked", value: "wa•••@contoh.id" }}
        whatsapp={{ kind: "masked", value: "+62 812•••••890" }}
        whatsappReady
        value="email"
        onChange={() => {}}
        {...props}
      />,
    )

  test("two large options with the masked destinations", () => {
    const html = render()
    expect(html.match(/type="radio"/g)?.length).toBe(2)
    expect(html).toContain("wa•••@contoh.id")
    expect(html).toContain("+62 812•••••890")
    expect(html).not.toContain('disabled=""')
  })

  test("the identifier not typed shows no fragment", () => {
    const html = render({ whatsapp: { kind: "registered" } })
    expect(whatsappInput(html)).not.toContain('disabled=""')
    expect(html).toContain(m.signin_whatsapp_registered())
    expect(html).not.toContain("+62")
    expect(render({ email: { kind: "registered" } })).toContain(
      m.signin_email_registered(),
    )
  })

  test("WhatsApp down is shown, disabled, email stays", () => {
    const html = render({ whatsappReady: false })
    expect(whatsappInput(html)).toContain('disabled=""')
    expect(html).toContain(m.signin_whatsapp_unavailable())
  })

  test("an account without a number says so", () => {
    const html = render({ whatsapp: null })
    expect(whatsappInput(html)).toContain('disabled=""')
    expect(html).toContain(m.signin_whatsapp_missing())
  })

  test("a disabled option dims only its title, not the note", () => {
    const html = render({ whatsappReady: false })
    for (const label of html.match(/<label[^>]*>/g) ?? []) {
      expect(label).not.toContain("opacity")
    }
    const note = html.match(/<span id="signin-channel-whatsapp-detail"[^>]*>/)
    expect(note?.[0]).not.toContain("opacity")
  })

  test("an unproven identifier elsewhere forces its channel", () => {
    const html = render({ only: "whatsapp" })
    expect(html.match(/<input id="signin-channel-email"[^>]*>/)?.[0]).toContain(
      'disabled=""',
    )
    expect(html).toContain(m.signin_email_pending())
    expect(render({ only: "email" })).toContain(m.signin_whatsapp_pending())
    expect(render({ email: null })).toContain(m.signin_email_missing())
  })

  test("a single open channel is chosen for the person", () => {
    const masked = {
      email: { kind: "masked", value: "a" },
      whatsapp: { kind: "registered" },
      whatsappReady: true,
    } as const
    expect(openChannels(masked)).toEqual(["email", "whatsapp"])
    expect(openChannels({ ...masked, whatsappReady: false })).toEqual(["email"])
    expect(openChannels({ ...masked, whatsapp: null })).toEqual(["email"])
    expect(openChannels({ ...masked, only: "whatsapp" })).toEqual(["whatsapp"])
    expect(openChannels({ ...masked, email: null })).toEqual(["whatsapp"])
  })
})

describe("switching modes", () => {
  const empty = { identifier: "", name: "", email: "", phone: "" }
  const daftar = (email: string, phone: string) => {
    const data = new FormData()
    data.set("name", "Warga Uji")
    data.set("email", email)
    data.set("phone", phone)
    return data
  }

  test("Daftar to Masuk carries the registered identifier", () => {
    const data = daftar("warga@contoh.id", "0812 3456 7890")
    expect(valuesFrom(data, "sign-up", empty).identifier).toBe(
      "warga@contoh.id",
    )
    expect(valuesFrom(data, "sign-up", empty, "phone").identifier).toBe(
      "0812 3456 7890",
    )
    expect(valuesFrom(daftar("", "0812"), "sign-up", empty).identifier).toBe(
      "0812",
    )
  })

  test("Masuk to Daftar fills email or number", () => {
    const data = new FormData()
    data.set("identifier", "0812 3456 7890")
    expect(valuesFrom(data, "sign-in", empty)).toMatchObject({
      phone: "0812 3456 7890",
      email: "",
    })
  })
})

describe("form checks", () => {
  test("Daftar fields and box", () => {
    const ids = (fields: Parameters<typeof signUpProblems>[0]) =>
      signUpProblems(fields).map((problem) => problem.fieldId)
    expect(
      ids({ name: "", email: "x", phone: "0221234567", age: false }),
    ).toEqual(["signin-name", "signin-email", "signin-phone", "signin-age"])
    expect(
      ids({
        name: "Warga Uji",
        email: "warga@contoh.id",
        phone: "0812 3456 7890",
        age: true,
      }),
    ).toEqual([])
    const phone = signUpProblems({
      name: "Warga",
      email: "a@b.id",
      phone: "+1 415 555 0100",
      age: true,
    })
    expect(phone[0]?.message).toBe(m.error_phone_format())
  })

  test("Masuk takes email or an Indonesian mobile number", () => {
    expect(signInProblem("warga@contoh.id")).toBeUndefined()
    expect(signInProblem("0812 3456 7890")).toBeUndefined()
    expect(signInProblem("")).toBe(m.error_identifier_required())
    expect(signInProblem("warga")).toBe(m.error_identifier_format())
  })
})

describe("CodeForm", () => {
  test("accepts a pasted code with a space", () => {
    const html = renderToStaticMarkup(
      <CodeForm
        channel="email"
        to="a•••@b.id"
        errors={[]}
        busy={false}
        onSubmit={() => {}}
        onBack={() => {}}
      />,
    )
    expect(html).toContain('id="signin-code"')
    expect(html).not.toContain("maxLength")
    expect(html).not.toContain("maxlength")
  })
})

describe("sign-in messages", () => {
  test("a rate limit is not called a wrong code", () => {
    expect(verifyMessage("rate_limited")).toBe(m.error_code_rate_limited())
    expect(verifyMessage("wrong")).toBe(m.error_code_wrong())
    expect(sendMessage("rate_limited")).toBe(m.error_code_rate_limited())
    expect(sendMessage("captcha")).toBe(m.error_captcha_failed())
    expect(sendMessage("whatsapp_unavailable")).toBe(
      m.error_whatsapp_unavailable(),
    )
    expect(sendMessage("pending")).toBe(m.error_identifiers_pending())
  })
})

describe("one code field", () => {
  const html = renderToStaticMarkup(
    <CodeForm
      channel="email"
      to="a•••@b.id"
      errors={[]}
      busy={false}
      onSubmit={() => {}}
      onBack={() => {}}
    />,
  )

  test("is a single numeric one-time-code input", () => {
    expect(html.match(/<input/g)?.length).toBe(1)
    expect(html).toContain('inputMode="numeric"')
    expect(html).toContain('autoComplete="one-time-code"')
    expect(html).toContain('type="text"')
  })

  test("paste keeps digits, first six", () => {
    expect(codeDigits("123 456")).toBe("123456")
    expect(codeDigits(" 12-34-56-78 ")).toBe("123456")
  })

  test("only a whole insert submits, typing waits", () => {
    expect(insertedWholeCode("", "123456")).toBe(true)
    expect(insertedWholeCode("12345", "123456")).toBe(false)
    expect(insertedWholeCode("", "12345")).toBe(false)
  })
})

describe("pasteCode", () => {
  const field = (value: string) => {
    const sent: string[] = []
    const input = {
      value,
      form: { requestSubmit: () => void sent.push(input.value) },
    }
    return { input, sent }
  }

  test("a new code pasted over a full field submits", () => {
    const { input, sent } = field("123456")
    pasteCode(input, "654321")
    expect(input.value).toBe("654321")
    expect(sent).toEqual(["654321"])
  })

  test("spaced code submits, partial or long waits", () => {
    const spaced = field("")
    pasteCode(spaced.input, "123 456")
    expect(spaced.sent).toEqual(["123456"])
    const partial = field("")
    pasteCode(partial.input, "1234")
    expect(partial.input.value).toBe("1234")
    expect(partial.sent).toEqual([])
    const long = field("")
    pasteCode(long.input, "12345678")
    expect(long.input.value).toBe("123456")
    expect(long.sent).toEqual([])
  })
})

describe("resend", () => {
  const render = (remaining: number, count = 0) =>
    renderToStaticMarkup(
      <ResendCode
        remaining={remaining}
        count={count}
        sending={false}
        onResend={() => {}}
        widget={null}
      />,
    )

  test("waits sixty seconds with a visible count", () => {
    expect(RESEND_SECONDS).toBe(60)
    const html = render(42)
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain(m.signin_resend_wait({ time: "0:42" }))
  })

  test("ready at zero, spam hint after three", () => {
    expect(render(0)).not.toContain("aria-disabled=")
    expect(render(0)).toContain(m.signin_resend())
    expect(render(0, 2)).not.toContain(m.signin_resend_spam())
    expect(render(0, 3)).toContain(m.signin_resend_spam())
  })

  test("clock text", () => {
    expect(clockText(60)).toBe("1:00")
    expect(clockText(5)).toBe("0:05")
    expect(clockText(-3)).toBe("0:00")
  })
})

describe("secondsLeft", () => {
  const T = 1_000_000
  test("counts down from sixty, never above", () => {
    expect(secondsLeft(null, T)).toBe(0)
    // Clock read before the send
    expect(secondsLeft(T, T - 45_000)).toBe(60)
    expect(secondsLeft(T, T + 18_000)).toBe(42)
    expect(secondsLeft(T, T + 61_000)).toBe(0)
  })
})

describe("channel step focus", () => {
  const both: ChannelOptions = {
    email: { kind: "masked", value: "w•••@contoh.id" },
    whatsapp: { kind: "registered" },
    whatsappReady: true,
  }

  test("lands on the checked option", () => {
    expect(channelFocusId(both, "whatsapp")).toBe("signin-channel-whatsapp")
  })

  test("never on a disabled option", () => {
    expect(channelFocusId({ ...both, email: null }, undefined)).toBe(
      "signin-channel-whatsapp",
    )
    expect(channelFocusId({ ...both, only: "whatsapp" }, "email")).toBe(
      "signin-channel-whatsapp",
    )
  })

  test("nothing open: no option", () => {
    expect(
      channelFocusId({ ...both, email: null, whatsappReady: false }, undefined),
    ).toBeNull()
  })
})

describe("failed WhatsApp send", () => {
  const both: ChannelOptions = {
    email: { kind: "masked", value: "w•••@contoh.id" },
    whatsapp: { kind: "registered" },
    whatsappReady: true,
  }

  test("points to email only where email works", () => {
    expect(whatsappFailedNotice(both)).toEqual({
      text: m.signin_whatsapp_failed(),
      email: true,
    })
    for (const closed of [
      { ...both, email: null },
      { ...both, only: "whatsapp" as const },
    ]) {
      expect(whatsappFailedNotice(closed)).toEqual({
        text: m.signin_whatsapp_failed_retry(),
        email: false,
      })
    }
  })
})

describe("account check errors", () => {
  test("a failed check never claims a code was sent", () => {
    expect(lookupError({ kind: "failed" }, "warga@contoh.id")).toEqual({
      fieldId: "signin-identifier",
      message: m.error_account_check_failed(),
    })
    for (const kind of ["failed", "rate_limited"] as const) {
      const found = checkNewError({ kind })
      expect(found.fieldId).toBe("signin-next")
      expect(found.message).not.toBe(m.error_code_send_failed())
    }
    expect(checkNewError({ kind: "failed" }).message).toBe(
      m.error_account_check_failed(),
    )
    expect(checkNewError({ kind: "rate_limited" }).message).toBe(
      m.error_code_rate_limited(),
    )
  })

  test("an unproven identifier points to the other one, not Daftar only", () => {
    expect(lookupError({ kind: "unproven" }, "08123456789").message).toBe(
      m.error_phone_unproven(),
    )
    expect(lookupError({ kind: "unproven" }, "warga@contoh.id").message).toBe(
      m.error_email_unproven(),
    )
    expect(lookupError({ kind: "missing" }, "warga@contoh.id").message).toBe(
      m.error_account_missing(),
    )
  })
})
