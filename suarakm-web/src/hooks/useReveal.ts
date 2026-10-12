import { useEffect, useRef } from "react";

/**
 * Efek muncul saat di-scroll — meniru kelas `km-reveal` di km.itb.ac.id.
 * Elemen tetap terlihat bila JS/IntersectionObserver tidak ada atau pengguna memilih reduced-motion.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // sudah terlihat saat dimuat
    el.classList.add("km-reveal");
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.setAttribute("data-shown", "");
          obs.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}
