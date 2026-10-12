import type { ElementType } from "react";
import { cn } from "@/lib/cn";

/** Pita biru selebar layar dengan judul halaman — seperti "VISI & MISI" di halaman kabinet KM */
export function PitaJudul({ children, as: Tag = "h1", id, className }: { children: string; as?: ElementType; id?: string; className?: string }) {
  return (
    <div className={cn("bg-km-blue px-4 py-6 sm:py-8", className)}>
      <Tag id={id} className="text-center font-judul text-[clamp(2rem,5.6vw,3.8rem)] leading-none text-white">
        {children}
      </Tag>
    </div>
  );
}
