import { Check } from "lucide-react";
import { STATUS, STATUS_URUTAN } from "@/constants/status";
import { cn } from "@/lib/cn";
import type { StatusIsu } from "@/types/domain";

/** Pelacak 5 tahap: Reported → Verified → In Progress → Government Responded → Resolved — kotak biru ala nomor misi KM */
export function StatusTracker({ status, className }: { status: StatusIsu; className?: string }) {
  const posisi = STATUS_URUTAN.indexOf(status);
  return (
    <ol className={cn("grid gap-3 sm:grid-cols-5 sm:gap-0", className)} aria-label="Tahap penanganan isu">
      {STATUS.map((s, i) => {
        const lewat = i < posisi;
        const kini = i === posisi;
        return (
          <li key={s.id} className="relative flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2.5 sm:pr-3" aria-current={kini ? "step" : undefined}>
            {i < STATUS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-[1.125rem] left-10 hidden h-1 w-[calc(100%-2.5rem)] sm:block",
                  i < posisi ? "bg-km-navy" : "bg-km-navy/12",
                )}
              />
            )}
            <span
              className={cn(
                "relative grid size-10 shrink-0 place-items-center text-base font-semibold",
                lewat && "bg-km-navy text-white",
                kini && "bg-km-blue text-white shadow-[0_0_0_4px_rgb(23_107_255/0.2)]",
                !lewat && !kini && "border-2 border-km-navy/25 bg-white text-km-navy/60",
              )}
            >
              {lewat ? <Check className="size-5" aria-hidden /> : i + 1}
            </span>
            <span className="flex flex-col">
              <span className={cn("text-sm font-semibold", kini ? "text-km-blue" : lewat ? "text-km-navy" : "text-tinta-500")}>
                {s.label}
              </span>
              <span className="text-xs text-tinta-500">
                {s.labelEn}
                {kini && <span className="sr-only"> (tahap saat ini)</span>}
                {lewat && <span className="sr-only"> (selesai)</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
