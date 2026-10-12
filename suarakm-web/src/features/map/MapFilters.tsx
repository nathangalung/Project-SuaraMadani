import { KATEGORI } from "@/constants/categories";
import { PROVINSI } from "@/constants/regions";
import { STATUS } from "@/constants/status";
import { Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { MapFilter } from "./mapData";

interface Props {
  nilai: MapFilter;
  onUbah: (f: MapFilter) => void;
  gelap?: boolean;
}

/** Satu baris filter di atas peta (PDF §20: Kategori, Status, Wilayah) — tombol segmen bersudut tajam ala KM */
export function MapFilters({ nilai, onUbah, gelap }: Props) {
  const warnaLabel = gelap ? "text-white/80" : "text-km-navy";
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
      <fieldset className="min-w-0">
        <legend className={cn("mb-1.5 text-sm font-semibold", warnaLabel)}>Kategori</legend>
        <div className="flex overflow-x-auto border border-km-navy/12 bg-white">
          {[{ id: "semua" as const, labelPendek: "Semua" }, ...KATEGORI].map((k) => {
            const aktif = nilai.kategori === k.id;
            return (
              <label
                key={k.id}
                className={cn(
                  "cursor-pointer border-r border-km-navy/10 px-4 py-3 text-sm whitespace-nowrap transition-colors last:border-0 has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-3 has-[:focus-visible]:outline-km-blue",
                  aktif ? "bg-km-blue font-semibold text-white" : "text-km-navy hover:bg-km-cream",
                )}
              >
                <input
                  type="radio"
                  name="peta-kategori"
                  value={k.id}
                  checked={aktif}
                  onChange={() => onUbah({ ...nilai, kategori: k.id })}
                  className="sr-only"
                />
                {k.labelPendek}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-1 lg:justify-end">
        <label className="flex min-w-0 flex-col gap-1.5 lg:w-56">
          <span className={cn("text-sm font-semibold", warnaLabel)}>Status</span>
          <span className="relative">
            <Select
              className="border-transparent bg-white pr-10 text-sm"
              value={nilai.status}
              onChange={(e) => onUbah({ ...nilai, status: e.target.value as MapFilter["status"] })}
            >
              <option value="semua">Semua status</option>
              {STATUS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </span>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 lg:w-60">
          <span className={cn("text-sm font-semibold", warnaLabel)}>Wilayah</span>
          <span className="relative">
            <Select className="border-transparent bg-white pr-10 text-sm" value={nilai.wilayah} onChange={(e) => onUbah({ ...nilai, wilayah: e.target.value })}>
              <option value="nasional">Nasional</option>
              {PROVINSI.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nama}
                </option>
              ))}
            </Select>
          </span>
        </label>
      </div>
    </div>
  );
}
