import { Link } from "react-router";
import { cn } from "@/lib/cn";

/** Logo ala navbar km.itb.ac.id: lambang KM ITB + nama + periode kabinet. Lambang SEMENTARA dari km.itb.ac.id. */
export function Logo({ terang = false }: { terang?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-3" aria-label="SuaraKM — beranda">
      <img src="/logo-km.png" alt="" aria-hidden className={cn("size-11 shrink-0 object-contain", terang && "invert")} />
      <span className="flex flex-col leading-tight whitespace-nowrap">
        <span className={cn("text-xl font-bold", terang ? "text-white" : "text-km-navy")}>SuaraKM</span>
        <span className={cn("text-xs", terang ? "text-white/80" : "text-km-navy")}>Kabinet KM ITB 2026/2027</span>
      </span>
    </Link>
  );
}
