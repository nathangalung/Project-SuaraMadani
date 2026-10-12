import type { ReactNode } from "react";

/** Latar pastel bagian bawah ala km.itb.ac.id, dengan ornamen asli KM (public/landing). */
export function LatarKM({ children }: { children: ReactNode }) {
  const orn = "pointer-events-none absolute select-none";
  return (
    <div
      className="relative isolate overflow-hidden"
      style={{
        background:
          "radial-gradient(45% 30% at 0% 6%, #fbe29a 0%, transparent 70%), radial-gradient(45% 35% at 100% 70%, #c4e2f6 0%, transparent 70%), radial-gradient(45% 30% at 0% 80%, #e3f3b9 0%, transparent 70%), linear-gradient(180deg,#f7f6dc 0%,#f2f8ec 55%,#eef6f6 100%)",
      }}
    >
      <img src="/landing/star-white-pair.webp" alt="" aria-hidden className={`${orn} top-[8%] -left-[18%] -z-10 hidden w-[48%] opacity-90 lg:block`} />
      <img src="/landing/rings-45.svg" alt="" aria-hidden className={`${orn} -right-[10%] bottom-[6%] -z-10 w-[40%] opacity-80`} />
      {children}
    </div>
  );
}

/** Judul bagian Beranda: Tilt Warp putih di dalam kotak warna KM, rata tengah */
export function JudulKotak({ children, warna, id }: { children: string; warna: string; id: string }) {
  return (
    <h2 id={id} className="text-center font-judul text-[clamp(1.9rem,4.6vw,3.4rem)] leading-[1.15] text-white">
      <span className={`${warna} px-[0.22em] pb-[0.06em] [box-decoration-break:clone]`}>{children}</span>
    </h2>
  );
}
