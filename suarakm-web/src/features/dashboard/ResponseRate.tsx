import { formatAngka } from "@/lib/format";
import type { StatistikNasional } from "@/types/domain";

/** Angka utama dashboard ("Xx%" di wireframe): porsi isu aktif yang sudah direspons pemerintah */
export function ResponseRate({ s }: { s: StatistikNasional }) {
  const persen = s.tingkatRespons.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  return (
    <div className="relative isolate flex h-full flex-col overflow-hidden bg-km-blue p-6 text-white">
      <p className="pr-8 font-semibold">Tingkat respons pemerintah</p>
      <div className="mt-6">
        <p className="text-6xl leading-none font-bold sm:text-7xl">
          {persen}
          <span className="text-4xl sm:text-5xl">%</span>
        </p>
        <p className="mt-4 text-sm leading-snug text-white">
          {formatAngka(s.telahDirespons)} dari {formatAngka(s.isuAktif)} isu aktif sudah mendapat tanggapan resmi.
        </p>
      </div>
      <div className="mt-6 h-2.5 bg-km-navy/40 lg:mt-auto" aria-hidden>
        <div className="h-full bg-white" style={{ width: `${Math.min(100, s.tingkatRespons)}%` }} />
      </div>
    </div>
  );
}
