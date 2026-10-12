import { useEffect, useRef } from "react";

/**
 * Anak-anak elemen muncul bergantian (jeda 85ms) saat di-scroll — pola .km-stagger km.itb.ac.id.
 * Tidak aktif bila reduced-motion atau elemen sudah terlihat saat halaman dimuat.
 */
export function useStagger<T extends HTMLElement>(siap = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !siap || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    Array.from(el.children).forEach((c, i) => (c as HTMLElement).style.setProperty("--i", String(i)));
    el.classList.add("km-stagger");
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.setAttribute("data-shown", "");
          obs.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [siap]);
  return ref;
}
