import { Link } from "react-router";
import { Tag } from "lucide-react";
import { Badge, Card, LabelLaporan, StatusBadge } from "@/components/ui";
import { KATEGORI_MAP } from "@/constants/categories";
import { Timeline } from "@/features/issues/components/Timeline";
import { formatTanggalPanjang } from "@/lib/format";
import type { ReportTracking } from "@/types/domain";

/** Hasil lacak: Report ID ditampilkan seperti label nama + NIM di halaman kabinet KM (kotak biru + kotak lime) */
export function TrackingResult({ data }: { data: ReportTracking }) {
  return (
    <Card varian="pastel">
      <div className="px-6 pt-6 sm:px-8 sm:pt-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <LabelLaporan
            reportId={data.reportId}
            baris={[
              { label: "Kategori", nilai: KATEGORI_MAP[data.kategori].labelPendek },
              { label: "Dikirim", nilai: formatTanggalPanjang(data.dikirim) },
            ]}
            className="mt-2"
          />
          {data.status === "ditolak" ? <Badge className="bg-km-red text-white">Ditolak</Badge> : <StatusBadge status={data.status} />}
        </div>
        <h2 className="mt-5 text-2xl leading-snug font-semibold">{data.judul}</h2>
        <div className="mt-2 flex flex-col gap-1 text-sm text-tinta-700 sm:flex-row sm:gap-5">
          <span className="inline-flex items-center gap-1.5">
            <Tag className="size-4 text-km-blue" aria-hidden />
            {KATEGORI_MAP[data.kategori].labelPendek} · {data.subkategori}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-8 border-t border-km-navy/15 p-6 sm:p-8 md:grid-cols-[1fr_16rem]">
        <div>
          <h3 className="font-bold text-xl">Riwayat laporan</h3>
          <Timeline items={data.riwayat} className="mt-5 ml-1.5" />
        </div>

        {data.isuTerkaitId && (
          <div className="self-start bg-km-navy p-5 text-white">
            <p className="text-sm text-white/85">Laporanmu sudah digabung ke isu publik</p>
            <p className="mt-1 font-bold text-2xl">{data.isuTerkaitId}</p>
            <Link to={`/isu/${data.isuTerkaitId}`} className="mt-3 inline-block text-sm font-semibold text-white underline-offset-2 hover:underline">
              Lihat perkembangan isu
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}
