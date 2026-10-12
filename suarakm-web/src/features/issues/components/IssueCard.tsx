import { Link } from "react-router";
import { FileText, MapPin, ThumbsUp } from "lucide-react";
import { KategoriBadge, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatAngka, waktuRelatif } from "@/lib/format";
import type { PublicIssue } from "@/types/domain";

/** Kartu isu: putih, sudut tajam, label kategori netral + status */
export function IssueCard({ issue, className }: { issue: PublicIssue; className?: string }) {
  return (
    <Link
      to={`/isu/${issue.id}`}
      className={cn("group flex flex-col border border-km-navy/12 bg-white transition-colors hover:border-km-navy", className)}
    >
      <div className="border-b border-km-navy/8 px-5 pt-5 pb-4">
        <div className="flex flex-wrap gap-1.5">
          <KategoriBadge kategori={issue.kategori} />
          <StatusBadge status={issue.status} />
        </div>
        <p className="mt-3 font-ui text-sm font-semibold text-tinta-600">{issue.subkategori}</p>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg leading-snug font-bold text-km-navy group-hover:underline group-hover:decoration-km-blue group-hover:decoration-2 group-hover:underline-offset-4">
          {issue.judul}
        </h3>
        <p className="mt-2 line-clamp-2 font-ui text-[0.95rem] leading-relaxed text-tinta-600">{issue.ringkasan}</p>

        <p className="mt-3 flex items-center gap-1.5 font-ui text-[0.95rem] text-tinta-700">
          <MapPin className="size-4 shrink-0 text-km-blue" aria-hidden />
          <span className="truncate">
            {issue.wilayah.provinsi}
            {issue.wilayah.kabupaten && ` · ${issue.wilayah.kabupaten}`}
          </span>
        </p>

        <div className="mt-auto pt-4">
          <div className="flex items-center gap-4 border-t border-km-navy/10 pt-3.5 font-ui text-[0.95rem] text-tinta-700">
            <span className="flex items-center gap-1.5" title="Jumlah laporan">
              <FileText className="size-4 text-km-blue" aria-hidden />
              {formatAngka(issue.jumlahLaporan)} <span className="sr-only">laporan</span>
            </span>
            <span className="flex items-center gap-1.5" title="Dukungan">
              <ThumbsUp className="size-4 text-km-blue" aria-hidden />
              {formatAngka(issue.dukungan)} <span className="sr-only">dukungan</span>
            </span>
            <span className="ml-auto text-xs text-tinta-500">Diperbarui {waktuRelatif(issue.diperbarui)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function IssueCardSkeleton() {
  return (
    <div className="border border-km-navy/12 bg-white">
      <div className="h-24 animate-pulse bg-km-navy/8" />
      <div className="space-y-3 p-5">
        <div className="h-5 w-4/5 animate-pulse bg-km-navy/8" />
        <div className="h-4 w-full animate-pulse bg-km-navy/8" />
        <div className="h-4 w-2/3 animate-pulse bg-km-navy/8" />
      </div>
    </div>
  );
}
