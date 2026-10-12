import { KATEGORI } from "@/constants/categories";
import { cn } from "@/lib/cn";
import { formatAngka } from "@/lib/format";
import type { ProvinsiAgregat } from "@/types/domain";
import { urutkanProvinsi, type MapFilter } from "./mapData";

/** Tampilan tabel peta — padanan aksesibel untuk gelembung */
export function ProvinceTable({ data, filter, onPilih }: { data: ProvinsiAgregat[]; filter: MapFilter; onPilih?: (id: string) => void }) {
  const baris = urutkanProvinsi(data, filter);
  const satuan = baris[0]?.satuan ?? "laporan";
  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Sebaran {satuan} per provinsi sesuai filter</caption>
        <thead className="sticky top-0 z-10 bg-km-navy text-left text-xs text-white">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Provinsi</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">Nilai ({satuan})</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">Total laporan</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">Isu aktif</th>
            {KATEGORI.map((k) => (
              <th key={k.id} scope="col" className="px-4 py-3 text-right font-semibold">
                {k.labelPendek}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {baris.map(({ p, nilai, perkiraan }) => (
            <tr
              key={p.id}
              className={cn("border-t border-km-navy/10", filter.wilayah === p.id && "bg-km-blue/10")}
            >
              <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                {onPilih ? (
                  <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onPilih(p.id)}>
                    {p.nama}
                  </button>
                ) : (
                  p.nama
                )}
              </th>
              <td className="px-4 py-2.5 text-right font-semibold">
                {formatAngka(nilai)}
                {perkiraan && <span className="text-tinta-500">*</span>}
              </td>
              <td className="px-4 py-2.5 text-right text-tinta-700">{formatAngka(p.jumlahLaporan)}</td>
              <td className="px-4 py-2.5 text-right text-tinta-700">{formatAngka(p.isuAktif)}</td>
              {KATEGORI.map((k) => (
                <td key={k.id} className="px-4 py-2.5 text-right text-tinta-700">
                  {formatAngka(p.perKategori[k.id])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
