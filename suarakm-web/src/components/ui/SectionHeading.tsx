import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useReveal } from "@/hooks/useReveal";

interface Props {
  judul: string;
  deskripsi?: ReactNode;
  aksi?: ReactNode;
  className?: string;
  id?: string;
  /** "kiri" (default) sejajar dengan grid kartu; "tengah" untuk halaman pendek */
  rata?: "kiri" | "tengah";
  /** teks putih untuk band biru laut */
  gelap?: boolean;
}

/**
 * Judul seksi: Tilt Warp, huruf kalimat biasa, navy — seperti judul "Profil" di km.itb.ac.id.
 * Tanpa kotak, pendar, atau label kecil di atasnya.
 */
export function SectionHeading({ judul, deskripsi, aksi, className, id, rata = "kiri", gelap = false }: Props) {
  const ref = useReveal<HTMLDivElement>();
  const tengah = rata === "tengah";
  return (
    <div
      ref={ref}
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col gap-5",
        tengah ? "items-center text-center" : "sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className={cn("max-w-2xl", tengah && "mx-auto")}>
        <h2 id={id} className={cn("font-judul text-[clamp(2rem,4.4vw,3rem)] leading-[1.1]", gelap ? "text-white" : "text-km-navy")}>
          {judul}
        </h2>
        {deskripsi && <p className={cn("mt-3 text-lg leading-relaxed", gelap ? "text-white/80" : "text-tinta-700")}>{deskripsi}</p>}
      </div>
      {aksi && <div className="shrink-0">{aksi}</div>}
    </div>
  );
}
