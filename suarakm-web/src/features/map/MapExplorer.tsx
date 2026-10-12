import { useState } from "react";
import { Map as IkonPeta, Table2 } from "lucide-react";
import { KATEGORI_MAP } from "@/constants/categories";
import { STATUS_MAP } from "@/constants/status";
import { cn } from "@/lib/cn";
import { formatAngka } from "@/lib/format";
import type { ProvinsiAgregat } from "@/types/domain";
import { WARNA_KATEGORI, WARNA_SEMUA } from "@/features/dashboard/chartTheme";
import { IssueMap } from "./IssueMap";
import { MapFilters } from "./MapFilters";
import { ProvinceTable } from "./ProvinceTable";
import { FILTER_AWAL, urutkanProvinsi, type MapFilter } from "./mapData";

/** Peta isu nasional lengkap: filter + peta/tabel + panel 5 provinsi teratas */
export function MapExplorer({ data }: { data: ProvinsiAgregat[] }) {
  const [filter, setFilter] = useState<MapFilter>(FILTER_AWAL);
  const [mode, setMode] = useState<"peta" | "tabel">("peta");

  const peringkat = urutkanProvinsi(data, filter);
  const teratas = peringkat.slice(0, 5);
  const maks = Math.max(1, teratas[0]?.nilai ?? 1);
  const satuan = peringkat[0]?.satuan ?? "laporan";
  const adaPerkiraan = peringkat.some((r) => r.perkiraan);
  const total = peringkat.reduce((s, r) => s + r.nilai, 0);
  const warna = filter.kategori === "semua" ? WARNA_SEMUA : WARNA_KATEGORI[filter.kategori];
  const dipilih = data.find((p) => p.id === filter.wilayah);
  const nilaiDipilih = peringkat.find((r) => r.p.id === filter.wilayah);

  const pilih = (id: string) => setFilter((f) => ({ ...f, wilayah: f.wilayah === id ? "nasional" : id }));

  const ringkasanFilter = [
    filter.kategori === "semua" ? "semua kategori" : KATEGORI_MAP[filter.kategori].labelPendek.toLowerCase(),
    filter.status === "semua" ? null : `status ${STATUS_MAP[filter.status].label.toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col gap-6">
      <MapFilters nilai={filter} onUbah={setFilter} gelap />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="overflow-hidden border border-km-navy/12 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-km-navy px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3 text-sm">
              <span className="flex items-center gap-2">
                <span className="size-3 rounded-full ring-2 ring-white" style={{ background: warna }} aria-hidden />
                {formatAngka(total)} {satuan} · {ringkasanFilter}
              </span>
            </div>
            <div role="group" aria-label="Tampilan" className="flex border-2 border-km-navy text-sm">
              {(
                [
                  { id: "peta", label: "Peta", Ikon: IkonPeta },
                  { id: "tabel", label: "Tabel", Ikon: Table2 },
                ] as const
              ).map(({ id, label, Ikon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={mode === id}
                  onClick={() => setMode(id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5",
                    mode === id ? "bg-km-navy font-semibold text-white" : "text-km-navy hover:bg-km-cream",
                  )}
                >
                  <Ikon className="size-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "peta" ? (
            <div className="relative">
              <IssueMap data={data} filter={filter} onSelectProvinsi={pilih} className="h-[340px] sm:h-[460px] lg:h-[520px]" />
              <UkuranLegenda warna={warna} satuan={satuan} />
            </div>
          ) : (
            <ProvinceTable data={data} filter={filter} onPilih={pilih} />
          )}
          {adaPerkiraan && (
            <p className="border-t border-km-navy/10 px-5 py-2.5 text-xs text-tinta-600">
              * Kombinasi kategori + status adalah perkiraan proporsional dari data agregat.
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-4 bg-[#eef4fd] p-5">
          {dipilih && nilaiDipilih ? (
            <div className="bg-km-navy p-4 text-white">
              <p className="text-xs text-white/75">Wilayah dipilih</p>
              <p className="mt-0.5 font-semibold">{dipilih.nama}</p>
              <p className="mt-2 font-bold text-3xl">{formatAngka(nilaiDipilih.nilai)}</p>
              <p className="text-sm text-white/80">
                {satuan} · {formatAngka(dipilih.isuAktif)} isu aktif
              </p>
              <button
                type="button"
                onClick={() => setFilter((f) => ({ ...f, wilayah: "nasional" }))}
                className="mt-3 text-sm font-semibold text-white underline-offset-2 hover:underline"
              >
                Kembali ke nasional
              </button>
            </div>
          ) : null}
          <div>
            <h3 className="font-bold text-xl">5 provinsi teratas</h3>
            <p className="text-sm text-tinta-700">Jumlah {satuan}, {ringkasanFilter}</p>
          </div>
          <ol className="flex flex-col gap-1">
            {teratas.map(({ p, nilai }, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => pilih(p.id)}
                  aria-pressed={filter.wilayah === p.id}
                  className={cn(
                    "w-full px-2 py-2 text-left transition-colors hover:bg-white/70",
                    filter.wilayah === p.id && "bg-white",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="grid size-6 place-items-center bg-km-blue text-xs font-semibold text-white tabular-nums">{i + 1}</span>
                      {p.nama}
                    </span>
                    <span className="font-semibold tabular-nums">{formatAngka(nilai)}</span>
                  </span>
                  <span className="mt-1.5 block h-2 bg-km-navy/8">
                    <span
                      className="block h-full"
                      style={{ width: `${(nilai / maks) * 100}%`, background: warna }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-auto text-xs leading-relaxed text-tinta-700">
            Titik menunjukkan agregat per provinsi. Lokasi presisi pelapor tidak pernah ditampilkan.
          </p>
        </aside>
      </div>
    </div>
  );
}

function UkuranLegenda({ warna, satuan }: { warna: string; satuan: string }) {
  return (
    <div className="pointer-events-none absolute bottom-12 left-3 z-[500] flex items-end gap-2 bg-white/95 px-3 py-2 text-xs ring-1 ring-km-navy/15 sm:bottom-7">
      {[4, 8, 13].map((r) => (
        <span
          key={r}
          className="rounded-full border-2 border-white"
          style={{ width: r * 2, height: r * 2, background: warna, opacity: 0.72 }}
          aria-hidden
        />
      ))}
      <span className="ml-1 pb-0.5">Lebih besar = lebih banyak {satuan}</span>
    </div>
  );
}
