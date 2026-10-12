import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Report ID sebagai stiker label nama ala buku tulis sekolah
 * (ide dari gaya "Superr" di styles.refero.design): label putih bergaris,
 * sedikit miring, dengan kolom "No. Laporan / Kategori / Tanggal".
 */
interface Props {
  reportId: string;
  baris: { label: string; nilai: ReactNode }[];
  className?: string;
  /** derajat kemiringan */
  putar?: number;
}

export function LabelLaporan({ reportId, baris, className, putar = 0 }: Props) {
  return (
    <figure
      className={cn("relative w-full max-w-md border border-km-navy/15 bg-white p-1.5", className)}
      style={{ rotate: `${putar}deg` }}
    >
      <div className="border-2 border-km-navy">
        <figcaption className="flex items-center justify-between bg-km-blue px-4 py-1.5 text-sm text-white">
          <span className="font-bold">SuaraKM</span>
          <span>KM Lapor!</span>
        </figcaption>
        <div className="px-4 pt-3 pb-4">
          <p className="text-xs text-tinta-600">No. Laporan</p>
          <p className="border-b-2 border-dotted border-km-navy/40 pb-1 font-bold text-[clamp(1.7rem,6vw,2.6rem)] leading-tight text-km-navy">
            #{reportId}
          </p>
          <dl className={cn("mt-3 grid gap-x-4", baris.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
            {baris.map((b) => (
              <div key={b.label}>
                <dt className="text-xs text-tinta-600">{b.label}</dt>
                <dd className="border-b-2 border-dotted border-km-navy/40 pb-1 font-semibold">{b.nilai}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </figure>
  );
}
