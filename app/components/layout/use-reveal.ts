import { useEffect, useRef } from "react"

type Entrance = {
  className: string
  rootMargin: string
  // Viewport share counted as seen
  seenRatio: number
}

// Hide only elements still offscreen
function useEntrance<T extends HTMLElement>({
  className,
  rootMargin,
  seenRatio,
}: Entrance) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let first = true
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (first) {
          first = false
          // Visible on load: never hide
          if (entry.boundingClientRect.top < window.innerHeight * seenRatio) {
            return observer.disconnect()
          }
          el.classList.add(className)
          return
        }
        if (entry.isIntersecting) {
          el.setAttribute("data-shown", "")
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [className, rootMargin, seenRatio])
  return ref
}

export function useReveal<T extends HTMLElement>() {
  return useEntrance<T>({
    className: "reveal",
    rootMargin: "0px 0px -10% 0px",
    seenRatio: 1,
  })
}

// Children set --i in JSX
export function useStagger<T extends HTMLElement>() {
  return useEntrance<T>({
    className: "stagger",
    rootMargin: "0px 0px -12% 0px",
    seenRatio: 0.9,
  })
}
