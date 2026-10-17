import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { choicesFrom, RadioGroup } from "./choices"

const labels = { a: () => "Pilihan A", b: () => "Pilihan B", c: () => "C" }

function render(value: string | undefined) {
  return renderToStaticMarkup(
    <RadioGroup
      name="pick"
      legend="Pilih"
      options={choicesFrom(["a", "b", "c"], labels)}
      value={value}
      onChange={() => {}}
      conditional={{ b: <p>Pertanyaan lanjutan</p> }}
    />,
  )
}

describe("RadioGroup conditional reveal", () => {
  test("follow-up sits right after its own option", () => {
    const html = render("b")
    const optionB = html.indexOf('value="b"')
    const followUp = html.indexOf("Pertanyaan lanjutan")
    const optionC = html.indexOf('value="c"')
    expect(optionB).toBeLessThan(followUp)
    expect(followUp).toBeLessThan(optionC)
  })

  test("the triggering radio controls the follow-up", () => {
    const html = render("b")
    expect(html).toMatch(/<input[^>]*aria-controls="pick-b-conditional"[^>]*>/)
    expect(html).toContain('id="pick-b-conditional"')
    expect(html).not.toMatch(/<input[^>]*value="a"[^>]*aria-controls/)
  })

  test("follow-up is hidden until its option is chosen", () => {
    expect(render("a")).toMatch(/id="pick-b-conditional"[^>]*hidden/)
    expect(render("b")).not.toMatch(/id="pick-b-conditional"[^>]*hidden/)
  })
})

describe("choicesFrom", () => {
  test("adds a hint per option when given", () => {
    const html = renderToStaticMarkup(
      <RadioGroup
        name="kind"
        legend="Jenis"
        options={choicesFrom(["a"], labels, { a: () => "Penjelasan A" })}
        value={undefined}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('id="kind-hint"')
    expect(html).toContain("Penjelasan A")
  })
})

describe("required radio groups", () => {
  function group(requiredMark: boolean) {
    return renderToStaticMarkup(
      <RadioGroup
        name="need"
        legend="Wajib"
        requiredMark={requiredMark}
        options={choicesFrom(["a", "b"], labels)}
        value={undefined}
        onChange={() => {}}
      />,
    )
  }

  test("every radio of a marked group is required", () => {
    const radios = group(true).match(/<input[^>]*>/g) ?? []
    expect(radios.length).toBe(2)
    for (const radio of radios) expect(radio).toContain('required=""')
  })

  test("unmarked groups stay optional", () => {
    expect(group(false)).not.toMatch(/<input[^>]*required/)
  })
})
