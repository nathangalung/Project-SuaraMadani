import { STATUS } from "@/constants/status";
import { formatAngka } from "@/lib/format";
import type { ProvinsiAgregat } from "@/types/domain";
import { ChartCard, TabelSederhana } from "./ChartCard";
import { RAMP_ORDINAL } from "./chartTheme";

/** Isu per tahap alur penanganan (urutan → ramp ordinal satu hue) */
export function StatusFlow({ data }: { data: ProvinsiAgregat[] }) {
  const baris = STATUS.map((s) => ({ s, nilai: data.reduce((a, p) => a + p.perStatus[s.id], 0) }));
  const maks = Math.max(...baris.map((b) => b.nilai), 1);
  return (
    <ChartCard
      judul="Isu per tahap penanganan"
      deskripsi="Dari laporan masuk sampai dinyatakan selesai."
      tabel={<TabelSederhana kolom={["Tahap", "Isu"]} baris={baris.map((b) => [b.s.label, formatAngka(b.nilai)])} />}
    >
      <ol className="flex flex-col gap-3">
        {baris.map(({ s, nilai }, i) => (
          <li key={s.id} className="grid grid-cols-[minmax(0,10.75rem)_1fr] items-center gap-3 text-sm" title={s.deskripsi}>
            <span className="truncate text-tinta-800">
              <span className="mr-1.5 text-tinta-500 tabular-nums">{i + 1}</span>
              {s.label}
            </span>
            <span className="grid grid-cols-[1fr_2.25rem] items-center gap-2">
              <span className="block h-3">
                <span
                  className="block h-full min-w-1"
                  style={{ width: `${(nilai / maks) * 100}%`, background: RAMP_ORDINAL[i] }}
                />
              </span>
              <span className="text-right font-semibold text-tinta-900 tabular-nums">{formatAngka(nilai)}</span>
            </span>
          </li>
        ))}
      </ol>
    </ChartCard>
  );
}
