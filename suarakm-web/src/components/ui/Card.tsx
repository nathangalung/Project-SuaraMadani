import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/*
 * Kotak dipakai HANYA untuk objek: sesuatu yang bisa diklik (kartu isu), diisi (panel form),
 * atau panel dashboard. Daftar, langkah, statistik → pakai garis tipis (GridGaris / tabel bergaris).
 *  - "putih" : putih + garis tepi tipis, tanpa bayangan
 *  - "pastel": blok warna biru sangat muda, rata (tanpa gradien, tanpa garis)
 *  - "navy"  : blok biru laut, teks putih
 */
type Varian = "putih" | "pastel" | "navy";

const varian: Record<Varian, string> = {
  putih: "border border-km-navy/12 bg-white",
  pastel: "bg-[#eef4fd]",
  navy: "bg-km-navy text-white",
};

export function Card({ className, varian: v = "putih", ...rest }: HTMLAttributes<HTMLDivElement> & { varian?: Varian }) {
  return <div className={cn(varian[v], className)} {...rest} />;
}
