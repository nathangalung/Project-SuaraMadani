import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Grid bergaris (ide dari teenage engineering di styles.refero.design):
 * isi dipisah garis 1px, tanpa kotak, tanpa bayangan, tanpa isian latar.
 */
interface Item {
  judul: ReactNode;
  isi: ReactNode;
}

export function GridGaris({ items, kolom = 4, bernomor = true, className }: { items: Item[]; kolom?: 2 | 3 | 4; bernomor?: boolean; className?: string }) {
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[kolom];
  const Tag = bernomor ? "ol" : "ul";
  return (
    <Tag className={cn("mx-auto grid max-w-6xl border-t-2 border-km-navy", grid, className)}>
      {items.map((it, i) => (
        <li key={i} className="border-b border-km-navy/15 py-6 sm:pr-8 sm:odd:border-r-0">
          {bernomor && <span className="block font-ui text-sm font-semibold text-km-blue tabular-nums">{String(i + 1).padStart(2, "0")}</span>}
          <h3 className="mt-2 text-lg font-bold leading-snug">{it.judul}</h3>
          <p className="mt-2 font-ui text-[0.95rem] leading-relaxed text-tinta-700">{it.isi}</p>
        </li>
      ))}
    </Tag>
  );
}
