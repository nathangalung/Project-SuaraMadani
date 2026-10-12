import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  label: string;
  nilai: ReactNode;
  keterangan?: ReactNode;
  kecil?: boolean;
  className?: string;
}

/** Angka ala band biru laut KM: garis kiri biru, angka Aleo bold putih, label di bawah (dipakai di dalam <dl>) */
export function StatTile({ label, nilai, keterangan, kecil, className }: Props) {
  return (
    <div className={cn("flex flex-col-reverse border-l-4 border-km-blue pl-4", className)}>
      <dt className="mt-2 text-sm text-white/80">
        {label}
        {keterangan && <span className="block text-xs text-white/60">{keterangan}</span>}
      </dt>
      <dd className={cn("font-bold leading-none text-white", kecil ? "text-2xl sm:text-3xl" : "text-[clamp(2rem,4.4vw,3rem)]")}>
        {nilai}
      </dd>
    </div>
  );
}
