import type { ReactNode } from "react";

interface Props {
  judul: string;
  /** keterangan kecil di atas judul, mis. "Database isu & tuntutan publik" */
  label?: string;
  deskripsi?: ReactNode;
  children?: ReactNode;
}

/**
 * Header halaman dalam: gradasi navbar (mint → kuning) diteruskan ke bawah lalu memudar ke krem halaman,
 * jadi tidak ada batas tegas antara navbar dan judul. Judul Tilt Warp navy, rata tengah.
 */
export function PageHeader({ judul, label, deskripsi, children }: Props) {
  return (
    <header className="relative isolate">
      <div aria-hidden className="gradien-navbar absolute inset-0 -z-10 [mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_100%)]" />
      <div className="mx-auto max-w-3xl px-4 pt-10 pb-4 text-center sm:px-6 sm:pt-16">
        {label && <p className="font-ui text-sm font-semibold tracking-wide text-km-navy/75 uppercase">{label}</p>}
        <h1 className="mt-2 font-judul text-[clamp(2rem,5.6vw,3.8rem)] leading-none text-km-navy">{judul}</h1>
        {deskripsi && <p className="mt-5 text-lg leading-relaxed text-km-navy">{deskripsi}</p>}
        {children}
      </div>
    </header>
  );
}
