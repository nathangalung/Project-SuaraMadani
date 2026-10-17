import { KM_ITB_DIR as DIR } from "~/components/layout/brand-assets"

const RINGS_SRC = `${DIR}/rings-45.svg`

const starSet = (format: "avif" | "webp") =>
  `${DIR}/star-white-pair-640.${format} 640w, ${DIR}/star-white-pair-1200.${format} 1200w`

// Decorative, lazy, never on phones
export function StarPair({
  sizes,
  className,
}: {
  sizes: string
  className: string
}) {
  return (
    <picture>
      <source type="image/avif" srcSet={starSet("avif")} sizes={sizes} />
      <img
        src={`${DIR}/star-white-pair-640.webp`}
        srcSet={starSet("webp")}
        sizes={sizes}
        width={640}
        height={442}
        alt=""
        loading="lazy"
        decoding="async"
        className={className}
      />
    </picture>
  )
}

// Hero copy is desktop LCP
export function Rings({
  className,
  priority = false,
}: {
  className: string
  priority?: boolean
}) {
  return (
    <img
      src={RINGS_SRC}
      width={650}
      height={650}
      alt=""
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={className}
    />
  )
}
