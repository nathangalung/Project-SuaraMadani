import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Ya/tidak sebagai ikon + kata berwarna (hijau/merah) — tanpa blok warna, tidak bergantung warna saja */
export function Indikator({ ya, label, labelTidak, className }: { ya: boolean; label: string; labelTidak?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-ui text-sm font-semibold", ya ? "text-km-green" : "text-km-red", className)}>
      {ya ? <Check className="size-4" strokeWidth={3} aria-hidden /> : <X className="size-4" strokeWidth={3} aria-hidden />}
      {ya ? label : (labelTidak ?? `Belum ${label.toLowerCase()}`)}
    </span>
  );
}
