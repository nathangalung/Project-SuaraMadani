import type { ReactNode } from "react";
import { KATEGORI_MAP } from "@/constants/categories";
import { STATUS_MAP, URGENSI_MAP } from "@/constants/status";
import { cn } from "@/lib/cn";
import type { KategoriId, StatusIsu, Urgensi } from "@/types/domain";

/*
 * Label persegi warna solid ala KM ("KABINET KM ITB 2026/2027", nama + NIM di halaman kabinet).
 */
export type WarnaLabel = "biru" | "navy" | "merah" | "hijau" | "krem";

const WARNA: Record<WarnaLabel, string> = {
  biru: "bg-km-blue text-white",
  navy: "bg-km-navy text-white",
  merah: "bg-km-red text-white",
  hijau: "bg-km-green text-white",
  krem: "bg-[#ece6d2] text-km-navy",
};

export function Label({ warna = "biru", className, children }: { warna?: WarnaLabel; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 font-ui text-[0.8rem] leading-none font-bold", WARNA[warna], className)}>
      {children}
    </span>
  );
}

/** Alias lama */
export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 font-ui text-[0.8rem] leading-none font-bold", className)}>{children}</span>;
}

export function StatusBadge({ status, className }: { status: StatusIsu; className?: string }) {
  const s = STATUS_MAP[status];
  return <Badge className={cn(s.kelas, className)}>{s.label}</Badge>;
}

/** Kategori: chip netral + kotak kecil warna kategori (sama dengan warna di peta & grafik) */
export function KategoriBadge({ kategori, className }: { kategori: KategoriId; className?: string }) {
  const k = KATEGORI_MAP[kategori];
  return (
    <Badge className={cn("bg-km-navy/8 text-km-navy", className)}>
      <span aria-hidden className="size-2.5 shrink-0" style={{ background: k.warna.hex }} />
      {k.labelPendek}
    </Badge>
  );
}

export function UrgensiBadge({ urgensi, className }: { urgensi: Urgensi; className?: string }) {
  const u = URGENSI_MAP[urgensi];
  return <Badge className={cn(u.kelas, className)}>Urgensi {u.label.toLowerCase()}</Badge>;
}

/** Nomor dalam kotak biru — penanda urutan (misi 1, 2, 3 …) */
export function Nomor({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center bg-km-blue text-lg font-bold text-white", className)}>{children}</span>
  );
}
