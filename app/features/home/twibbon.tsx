import { Download, ImagePlus } from "lucide-react"
import { type ChangeEvent, useEffect, useId, useRef, useState } from "react"
import { SECTION_TITLE } from "~/components/layout/section-heading"
import { buttonClass } from "~/components/ui/button"
import { m } from "~/paraglide/messages.js"
import { useHydrated } from "../report/hydrated"

// KM ITB template, 22 Oct
export const TWIBBON_FILTER = "/twibbon/filter-kuning.jpg"
// Template on top, see-through
const FILTER_OPACITY = 0.72
const SIZE = 1080

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

/** Photo fills, template over it. */
async function compose(file: File): Promise<Blob> {
  const [photo, filter] = await Promise.all([
    createImageBitmap(file),
    loadImage(TWIBBON_FILTER),
  ])
  const canvas = document.createElement("canvas")
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext("2d")
  if (!context) throw new Error("no canvas")
  // Cover crop, centred
  const scale = Math.max(SIZE / photo.width, SIZE / photo.height)
  const width = photo.width * scale
  const height = photo.height * scale
  context.drawImage(
    photo,
    (SIZE - width) / 2,
    (SIZE - height) / 2,
    width,
    height,
  )
  photo.close()
  context.globalAlpha = FILTER_OPACITY
  context.drawImage(filter, 0, 0, SIZE, SIZE)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("no blob"))),
      "image/png",
    ),
  )
}

// Browser only, never uploaded
export function Twibbon() {
  const hydrated = useHydrated()
  const inputId = useId()
  const [result, setResult] = useState<string | null>(null)
  const [state, setState] = useState<"idle" | "working" | "failed">("idle")
  const last = useRef<string | null>(null)

  // Free the old preview
  useEffect(
    () => () => {
      if (last.current) URL.revokeObjectURL(last.current)
    },
    [],
  )

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return
    setState("working")
    try {
      const url = URL.createObjectURL(await compose(file))
      if (last.current) URL.revokeObjectURL(last.current)
      last.current = url
      setResult(url)
      setState("idle")
    } catch {
      setState("failed")
    }
  }

  return (
    <section
      aria-labelledby="twibbon-title"
      className="bg-page px-6 py-14 sm:px-10 lg:py-20"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
        <div className="flex flex-col items-center">
          <h2 id="twibbon-title" className={SECTION_TITLE}>
            {m.twibbon_title()}
          </h2>
          <p className="mt-3 max-w-5xl text-ink-soft text-lg leading-relaxed">
            {m.twibbon_lead()}
          </p>
          {hydrated ? (
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <label
                htmlFor={inputId}
                className={buttonClass(
                  "primary",
                  "lg",
                  "cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid",
                )}
              >
                <ImagePlus aria-hidden="true" className="size-5" />
                {state === "working"
                  ? m.twibbon_working()
                  : result
                    ? m.twibbon_change()
                    : m.twibbon_choose()}
                <input
                  id={inputId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={choose}
                />
              </label>
              {result ? (
                <a
                  href={result}
                  download="twibbon-sadar-bersuara.png"
                  className={buttonClass("secondary", "lg")}
                >
                  <Download aria-hidden="true" className="size-5" />
                  {m.twibbon_download()}
                </a>
              ) : null}
            </div>
          ) : (
            <p className="mt-6 font-ui text-ink-muted text-sm">
              {m.twibbon_needs_js()}
            </p>
          )}
          <div aria-live="polite">
            {state === "failed" ? (
              <p className="mt-3 font-semibold text-danger text-sm">
                {m.twibbon_error()}
              </p>
            ) : null}
          </div>
        </div>
        <figure className="relative mt-10 aspect-square w-full max-w-[26rem] overflow-hidden rounded-2xl border border-line-subtle bg-surface-raised">
          {result ? (
            <img
              src={result}
              alt={m.twibbon_preview()}
              className="size-full object-cover"
            />
          ) : (
            <>
              <span className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center font-semibold text-ink">
                {m.twibbon_empty()}
              </span>
              <img
                src={TWIBBON_FILTER}
                alt=""
                width={SIZE}
                height={SIZE}
                loading="lazy"
                decoding="async"
                className="relative size-full"
              />
            </>
          )}
        </figure>
      </div>
    </section>
  )
}
