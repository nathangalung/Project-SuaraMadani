import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Ornamen khas km.itb.ac.id: confetti cincin & busur, bintang bergaris pink→kuning,
 * bintang blur kuning-hijau, cincin konsentris, pita melengkung, dan latar pastel blur.
 * Semua dekoratif (aria-hidden) dan tidak menangkap klik.
 */

const dasar = "pointer-events-none absolute select-none";

/** Cincin confetti (hijau, lime, kuning, ungu…) */
export function Cincin({ className, warna = "#1a844f", tebal = 7 }: { className?: string; warna?: string; tebal?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 40 40" className={cn(dasar, className)}>
      <circle cx="20" cy="20" r={20 - tebal / 2 - 1} fill="none" stroke={warna} strokeWidth={tebal} />
    </svg>
  );
}

/** Busur confetti (merah, biru, pink, kuning) */
export function Busur({ className, warna = "#d81623", putar = 0 }: { className?: string; warna?: string; putar?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 40 40" className={cn(dasar, className)} style={{ rotate: `${putar}deg` }}>
      <path d="M7 27 A15 15 0 0 1 27 7" fill="none" stroke={warna} strokeWidth="7" />
    </svg>
  );
}

const BINTANG = "M50 4 C54 36 64 46 96 50 C64 54 54 64 50 96 C46 64 36 54 4 50 C36 46 46 36 50 4 Z";

/** Bintang bergaris tebal pink → oranye → kuning dengan pendar (halaman kabinet) */
export function BintangGaris({ className, putar = 0 }: { className?: string; putar?: number }) {
  const id = useId();
  return (
    <svg aria-hidden viewBox="0 0 100 100" className={cn(dasar, "overflow-visible", className)} style={{ rotate: `${putar}deg` }}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5aa0" />
          <stop offset="0.5" stopColor="#ff8a4c" />
          <stop offset="1" stopColor="#ffe030" />
        </linearGradient>
        <filter id={`${id}f`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <path d={BINTANG} fill="none" stroke={`url(#${id}g)`} strokeWidth="9" strokeLinejoin="round" filter={`url(#${id}f)`} opacity="0.6" />
      <path d={BINTANG} fill="none" stroke={`url(#${id}g)`} strokeWidth="7" strokeLinejoin="round" />
    </svg>
  );
}

/** Bintang isi kuning (bintang 3D di band biru laut) */
export function BintangKuning({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg aria-hidden viewBox="0 0 120 140" className={cn(dasar, className)}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffbe0" />
          <stop offset="1" stopColor="#ffe030" />
        </linearGradient>
      </defs>
      <path d="M52 6c4 34 10 46 40 52-30 6-36 18-40 52-4-34-10-46-40-52 30-6 36-18 40-52Z" fill={`url(#${id}g)`} stroke="#fff" strokeWidth="5" strokeLinejoin="round" />
      <path d="M96 30c2 13 5 17 16 20-11 3-14 7-16 20-2-13-5-17-16-20 11-3 14-7 16-20Z" fill={`url(#${id}g)`} stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

/** Bintang isi yang di-blur — bentuk latar kuning-hijau / putih */
export function BintangBlur({ className, warna = "linear-gradient(90deg,#9be7a1,#ffe030)", putar = 0 }: { className?: string; warna?: string; putar?: number }) {
  return (
    <div
      aria-hidden
      className={cn(dasar, "blur-[6px]", className)}
      style={{ background: warna, clipPath: "polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%)", rotate: `${putar}deg` }}
    />
  );
}

/** Cincin konsentris yang lembut (pojok-pojok latar & footer) */
export function Konsentris({ className, warna = "rgb(255 255 255 / 0.7)" }: { className?: string; warna?: string }) {
  return (
    <div
      aria-hidden
      className={cn(dasar, "rounded-full blur-[3px]", className)}
      style={{ background: `repeating-radial-gradient(circle, ${warna} 0 10px, transparent 10px 26px)`, maskImage: "radial-gradient(circle, #000 35%, transparent 70%)" }}
    />
  );
}

/** Pita melengkung tebal seperti di hero km.itb.ac.id */
export function Pita({ className, style }: { className?: string; style?: CSSProperties }) {
  const id = useId();
  return (
    <svg aria-hidden viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice" className={cn(dasar, "inset-0 h-full w-full", className)} style={style}>
      <defs>
        <linearGradient id={`${id}a`} gradientUnits="userSpaceOnUse" x1="0" y1="500" x2="420" y2="160">
          <stop offset="0" stopColor="#ffe030" />
          <stop offset="0.6" stopColor="#f6e66a" />
          <stop offset="1" stopColor="#9cf0e1" />
        </linearGradient>
        <linearGradient id={`${id}b`} gradientUnits="userSpaceOnUse" x1="520" y1="900" x2="900" y2="500">
          <stop offset="0" stopColor="#176bff" />
          <stop offset="1" stopColor="#5aa3ff" />
        </linearGradient>
        <filter id={`${id}f`}>
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>
      <g fill="none" strokeLinecap="round" filter={`url(#${id}f)`}>
        <path d="M-90 520 C40 320 220 150 350 205 C470 255 445 430 320 600" stroke={`url(#${id}a)`} strokeWidth="68" opacity="0.92" />
        <path d="M-90 520 C40 320 220 150 350 205 C470 255 445 430 320 600" stroke="#fff" strokeWidth="16" opacity="0.28" />
        <path d="M540 1000 C520 760 570 575 690 555 C830 532 905 720 1070 1000" stroke={`url(#${id}b)`} strokeWidth="76" opacity="0.85" />
        <path d="M1190 860 C1150 590 1180 345 1295 330 C1395 318 1450 380 1540 455" stroke={`url(#${id}b)`} strokeWidth="76" opacity="0.85" />
        <path d="M1190 860 C1150 590 1180 345 1295 330 C1395 318 1450 380 1540 455" stroke="#fff" strokeWidth="18" opacity="0.2" />
      </g>
    </svg>
  );
}

/** Latar pastel blur (kuning, mint, biru muda, koral) ala seksi berita/footer KM */
export function LatarPastel({ children, className, ornamen = false }: { children: ReactNode; className?: string; ornamen?: boolean }) {
  return (
    <div
      className={cn("relative isolate overflow-hidden", className)}
      style={{
        background: "radial-gradient(55% 45% at 100% 40%, #e3eefc 0%, transparent 70%), #fff8e5",
      }}
    >
      {ornamen && <Konsentris className="-right-28 bottom-[8%] -z-10 size-[22rem]" warna="rgb(23 107 255 / 0.12)" />}
      {children}
    </div>
  );
}
