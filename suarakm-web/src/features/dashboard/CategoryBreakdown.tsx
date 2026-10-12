import { KATEGORI } from "@/constants/categories";
import { formatAngka } from "@/lib/format";
import type { ProvinsiAgregat } from "@/types/domain";
import { ChartCard, TabelSederhana } from "./ChartCard";
import { WARNA_KATEGORI } from "./chartTheme";

/** Laporan per kategori utama — batang horizontal, label langsung di ujung */
export function CategoryBreakdown({ data }: { data: ProvinsiAgregat[] }) {
  const baris = KATEGORI.map((k) => ({
    k,
    nilai: data.reduce((s, p) => s + p.perKategori[k.id], 0),
  }));
  const total = baris.reduce((s, b) => s + b.nilai, 0) || 1;
  const maks = Math.max(...baris.map((b) => b.nilai), 1);

  return (
    <ChartCard
      judul="Laporan per kategori"
      deskripsi="Tiga kategori utama platform."
      tabel={
        <TabelSederhana
          kolom={["Kategori", "Laporan", "Porsi"]}
          baris={baris.map((b) => [b.k.labelPendek, formatAngka(b.nilai), `${Math.round((b.nilai / total) * 100)}%`])}
        />
      }
    >
      <ul className="flex flex-col gap-4">
        {baris.map(({ k, nilai }) => (
          <li key={k.id} title={`${k.label}: ${formatAngka(nilai)} laporan`}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-tinta-800">{k.labelPendek}</span>
              <span className="text-tinta-600 tabular-nums">{Math.round((nilai / total) * 100)}%</span>
            </div>
            <div className="mt-1.5 grid grid-cols-[1fr_3.5rem] items-center gap-2">
              <span className="block h-3">
                <span
                  className="block h-full"
                  style={{ width: `${(nilai / maks) * 100}%`, background: WARNA_KATEGORI[k.id] }}
                />
              </span>
              <span className="text-right text-sm font-semibold text-tinta-900 tabular-nums">{formatAngka(nilai)}</span>
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
