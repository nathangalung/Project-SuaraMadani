import { Link } from "react-router";
import { FileText } from "lucide-react";
import { formatTanggal } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PublicIssue, Tuntutan } from "@/types/domain";
import { Indikator } from "./TuntutanIndikator";

/*
 * Register tuntutan publik: satu tabel bergaris (garis navy 2px di atas, 1px antarbaris),
 * nomor biasa, status ya/tidak sebagai ikon + kata. Dipakai di beranda, dashboard, dan jelajah.
 * Di layar kecil tiap baris menumpuk menjadi blok bergaris.
 */
interface Props {
  data: Tuntutan[];
  /** tampilkan ringkasan & isu terkait (halaman jelajah) */
  lengkap?: boolean;
  isu?: PublicIssue[];
  /** versi rapat untuk panel dashboard */
  rapat?: boolean;
  className?: string;
}

export function TuntutanLedger({ data, lengkap = false, isu, rapat = false, className }: Props) {
  const judulIsu = (id: string) => isu?.find((i) => i.id === id)?.judul ?? id;
  const kolom = rapat ? "md:grid-cols-[2rem_1fr]" : "md:grid-cols-[3rem_1fr_9.5rem_9.5rem_8rem]";

  return (
    <div className={cn("border-t-2 border-km-navy", className)} role="table" aria-label="Daftar tuntutan publik">
      {!rapat && (
        <div role="row" className={cn("hidden border-b border-km-navy/15 py-2.5 font-ui text-sm font-semibold text-tinta-600 md:grid md:gap-4", kolom)}>
          <span role="columnheader">No.</span>
          <span role="columnheader">Tuntutan</span>
          <span role="columnheader">Direspons</span>
          <span role="columnheader">Dipenuhi</span>
          <span role="columnheader" className="text-right">
            Dokumen
          </span>
        </div>
      )}
      {data.map((t, i) => (
        <div key={t.id} role="row" className={cn("grid gap-x-4 gap-y-2 border-b border-km-navy/15", rapat ? "py-4" : "py-5", kolom)}>
          <span role="cell" className="font-ui text-lg font-semibold text-km-blue tabular-nums">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div role="cell" className="min-w-0">
            <p className={cn("font-bold leading-snug", rapat ? "text-base" : "text-lg")}>{t.judul}</p>
            {lengkap && <p className="mt-1.5 leading-relaxed text-tinta-700">{t.ringkasan}</p>}
            <p className="mt-1 font-ui text-sm text-tinta-600">
              Diajukan {formatTanggal(t.diajukan)} · {t.isuTerkait.length} isu terkait
            </p>
            {lengkap && (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {t.isuTerkait.map((id) => (
                  <li key={id}>
                    <Link to={`/isu/${id}`} className="font-ui text-sm font-semibold text-km-blue underline-offset-2 hover:underline">
                      {judulIsu(id)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {rapat && (
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                <Indikator ya={t.direspons} label="Direspons" />
                <Indikator ya={t.dipenuhi} label="Dipenuhi" />
                <a href={t.policyBriefUrl} className="inline-flex items-center gap-1 font-ui text-sm font-semibold text-km-blue hover:underline">
                  <FileText className="size-4" aria-hidden /> Policy brief
                </a>
              </div>
            )}
          </div>
          {!rapat && (
            <>
              <span role="cell" className="md:pt-1">
                <Indikator ya={t.direspons} label="Direspons" labelTidak="Belum direspons" />
              </span>
              <span role="cell" className="md:pt-1">
                <Indikator ya={t.dipenuhi} label="Dipenuhi" labelTidak="Belum dipenuhi" />
              </span>
              <span role="cell" className="md:pt-1 md:text-right">
                <a href={t.policyBriefUrl} className="inline-flex items-center gap-1.5 font-ui text-sm font-semibold text-km-blue hover:underline">
                  <FileText className="size-4" aria-hidden /> Policy brief
                </a>
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
