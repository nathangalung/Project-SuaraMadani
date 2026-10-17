import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { m } from "~/paraglide/messages.js"
import {
  Checkbox,
  describedBy,
  Fieldset,
  Radio,
  STEP_HEADING,
  Textarea,
  TextInput,
} from "./field"

describe("describedBy", () => {
  test("joins hint and error ids", () => {
    expect(describedBy("title", true, true)).toBe("title-hint title-error")
    expect(describedBy("title", true, false)).toBe("title-hint")
    expect(describedBy("title", false, true)).toBe("title-error")
    expect(describedBy("title", false, false)).toBeUndefined()
  })
})

describe("TextInput", () => {
  test("links hint and error to the input", () => {
    const html = renderToStaticMarkup(
      <TextInput
        id="title"
        name="title"
        label="Judul laporan"
        hint="Tulis singkat"
        error="Masukkan judul laporan"
      />,
    )
    expect(html).toContain('for="title"')
    expect(html).toContain('id="title-hint"')
    expect(html).toContain('id="title-error"')
    expect(html).toContain('aria-describedby="title-hint title-error"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('<span class="sr-only">Kesalahan:</span>')
    expect(html).not.toContain('role="alert"')
  })

  test("plain input has no describedby or invalid flag", () => {
    const html = renderToStaticMarkup(
      <TextInput id="name" name="name" label="Nama" />,
    )
    expect(html).not.toContain("aria-describedby")
    expect(html).not.toContain("aria-invalid")
  })

  test("label can be the page heading", () => {
    const html = renderToStaticMarkup(
      <TextInput id="email" name="email" label="Email Anda" labelAsHeading />,
    )
    expect(html).toMatch(/<h1[^>]*><label[^>]*for="email"/)
  })

  test("optional fields say so in the label", () => {
    const html = renderToStaticMarkup(
      <Textarea id="agency" name="agency" label="Instansi terkait" optional />,
    )
    expect(html).toContain("(opsional)")
    expect(html).toContain("<textarea")
  })
})

describe("Fieldset", () => {
  test("groups choices under a legend with linked error", () => {
    const html = renderToStaticMarkup(
      <Fieldset
        id="relation"
        legend="Apa Hubungan Anda dengan Masalah Ini?"
        legendAsHeading
        error="Pilih hubungan Anda dengan masalah ini"
      >
        <Radio
          id="relation-self"
          name="relation"
          value="self"
          label="Saya mengalaminya sendiri"
          hint="Anda terdampak langsung"
        />
        <Checkbox id="consent" name="consent" label="Saya setuju" />
      </Fieldset>,
    )
    expect(html).toMatch(/<fieldset[^>]*aria-describedby="relation-error"/)
    expect(html).toMatch(/<legend[^>]*><h1/)
    expect(html).toContain('type="radio"')
    expect(html).toContain('aria-describedby="relation-self-hint"')
    expect(html).toContain('type="checkbox"')
  })
})

describe("order and required marks", () => {
  test("error follows the control, hint precedes it", () => {
    const html = renderToStaticMarkup(
      <TextInput id="title" label="Judul" hint="Singkat" error="Isi judul" />,
    )
    const hint = html.indexOf('id="title-hint"')
    const control = html.indexOf("<input")
    const error = html.indexOf('id="title-error"')
    expect(hint).toBeLessThan(control)
    expect(control).toBeLessThan(error)
  })

  test("fieldset error follows its choices", () => {
    const html = renderToStaticMarkup(
      <Fieldset id="g" legend="Kelompok" hint="Pilih satu" error="Pilih">
        <Radio id="g1" name="g" value="1" label="Satu" />
      </Fieldset>,
    )
    expect(html.indexOf('id="g-hint"')).toBeLessThan(html.indexOf("<input"))
    expect(html.indexOf("<input")).toBeLessThan(html.indexOf('id="g-error"'))
  })

  test("marked fields show a hidden asterisk and are required", () => {
    const html = renderToStaticMarkup(
      <Textarea id="story" label="Cerita" requiredMark />,
    )
    expect(html).toContain(
      '<span aria-hidden="true" class="ml-0.5 text-danger">*</span>',
    )
    expect(html).toMatch(/<textarea[^>]*required=""/)
  })

  test("required alone adds no asterisk", () => {
    const html = renderToStaticMarkup(
      <TextInput id="email" label="Email" required />,
    )
    expect(html).toMatch(/<input[^>]*required=""/)
    expect(html).not.toContain(">*</span>")
  })

  test("group legends carry the mark, options never", () => {
    const html = renderToStaticMarkup(
      <Fieldset id="u" legend="Urgensi" requiredMark>
        <Radio id="u1" name="u" value="1" label="Biasa" />
        <Checkbox id="u2" name="v" value="2" label="Setuju" />
      </Fieldset>,
    )
    expect(html.match(/>\*<\/span>/g)?.length).toBe(1)
    expect(html).toMatch(/<legend[^>]*>Urgensi<span aria-hidden="true"/)
  })

  test("group legends tell screen readers it is required", () => {
    const html = renderToStaticMarkup(
      <Fieldset id="g" legend="Kelompok" requiredMark>
        <Checkbox id="g1" name="g" value="1" label="Siswa" />
      </Fieldset>,
    )
    expect(html).toContain(
      `<span class="sr-only"> ${m.field_required()}</span>`,
    )
    // Checkbox required means all
    expect(html).not.toMatch(/<input[^>]*required/)
  })

  test("unmarked legends add no hidden text", () => {
    const html = renderToStaticMarkup(
      <Fieldset id="g" legend="Kelompok">
        <Checkbox id="g1" name="g" value="1" label="Siswa" />
      </Fieldset>,
    )
    expect(html).not.toContain(m.field_required())
  })
})

describe("step card variants", () => {
  test("question heading is Aleo bold, not the display face", () => {
    const html = renderToStaticMarkup(
      <Fieldset id="q" legend="Pertanyaan" legendAsHeading>
        <Radio id="q1" name="q" value="1" label="Satu" />
      </Fieldset>,
    )
    expect(html).toContain(`<h1 class="${STEP_HEADING}">`)
    expect(STEP_HEADING).not.toContain("font-heading")
  })

  test("inline choices drop the hint and keep the label link", () => {
    const html = renderToStaticMarkup(
      <Radio id="u1" name="u" value="1" label="Biasa" hint="x" inline />,
    )
    expect(html).toContain('<label for="u1"')
    expect(html).not.toContain("u1-hint")
  })

  test("option grid replaces the default stack", () => {
    const html = renderToStaticMarkup(
      <Fieldset id="g" legend="G" optionsClassName="grid gap-3">
        <Radio id="g1" name="g" value="1" label="Satu" />
      </Fieldset>,
    )
    expect(html).toContain('class="mt-2 grid gap-3"')
    expect(html).not.toContain("flex flex-col gap-2")
  })
})
