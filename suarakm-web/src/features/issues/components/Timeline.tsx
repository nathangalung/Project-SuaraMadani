import { ExternalLink } from "lucide-react";
import { STATUS_MAP } from "@/constants/status";
import { cn } from "@/lib/cn";
import { formatTanggalPanjang } from "@/lib/format";
import type { StatusIsu } from "@/types/domain";

export interface TimelineItem {
  tanggal: string;
  status: StatusIsu | "ditolak";
  judul?: string;
  keterangan: string;
  sumber?: { label: string; url: string };
}

const LABEL_TOLAK = { label: "Ditolak", titik: "bg-km-red" };

/** Riwayat perubahan status — setiap perubahan terdokumentasi (prinsip Accountable) */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  const urut = [...items].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  return (
    <ol className={cn("relative space-y-6 border-l-[3px] border-km-navy/15 pl-6", className)}>
      {urut.map((e, i) => {
        const meta = e.status === "ditolak" ? LABEL_TOLAK : STATUS_MAP[e.status];
        return (
          <li key={`${e.tanggal}-${i}`} className="relative">
            <span
              aria-hidden
              className={cn("absolute top-1 -left-[calc(1.5rem+9px)] size-3.5 ring-4 ring-white", meta.titik, i === 0 && "top-0.5 size-4 -left-[calc(1.5rem+10px)]")}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <time dateTime={e.tanggal} className="text-sm text-tinta-600">
                {formatTanggalPanjang(e.tanggal)}
              </time>
              <span className="text-xs font-semibold text-km-blue">· {meta.label}</span>
            </div>
            {e.judul && <p className="mt-0.5 font-semibold text-km-navy">{e.judul}</p>}
            <p className="mt-0.5 leading-relaxed text-tinta-700">{e.keterangan}</p>
            {e.sumber && (
              <a
                href={e.sumber.url}
                className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-km-blue underline-offset-2 hover:underline"
              >
                {e.sumber.label}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
