import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui";
import { KATEGORI } from "@/constants/categories";
import { PROVINSI } from "@/constants/regions";
import { RANKING } from "@/constants/ranking";
import { STATUS } from "@/constants/status";
import { cn } from "@/lib/cn";
import type { IssueFilter } from "@/types/domain";

interface Props {
  filter: IssueFilter;
  ubah: (patch: Partial<IssueFilter>) => void;
}

const PILIHAN_KATEGORI = [{ id: "semua", labelPendek: "Semua" }, ...KATEGORI] as const;

export function IssueFilters({ filter, ubah }: Props) {
  // input cari pakai debounce supaya URL tidak berubah tiap ketukan
  const [cari, setCari] = useState(filter.q ?? "");
  useEffect(() => setCari(filter.q ?? ""), [filter.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (cari !== (filter.q ?? "")) ubah({ q: cari });
    }, 300);
    return () => clearTimeout(t);
  }, [cari, filter.q, ubah]);

  return (
    <div className="border-y-2 border-km-navy bg-white/60 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Cari isu</span>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-km-navy/60" aria-hidden />
          <Input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari isu, wilayah, atau instansi…"
            className="pl-11"
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex lg:w-auto">
          <label className="lg:w-44">
            <span className="sr-only">Status</span>
            <Select value={filter.status} onChange={(e) => ubah({ status: e.target.value as IssueFilter["status"] })}>
              <option value="semua">Semua status</option>
              {STATUS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="lg:w-48">
            <span className="sr-only">Provinsi</span>
            <Select value={filter.provinsiId} onChange={(e) => ubah({ provinsiId: e.target.value })}>
              <option value="semua">Semua provinsi</option>
              {PROVINSI.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nama}
                </option>
              ))}
            </Select>
          </label>
          <label className="lg:w-56">
            <span className="sr-only">Urutkan</span>
            <Select value={filter.urutkan} onChange={(e) => ubah({ urutkan: e.target.value as IssueFilter["urutkan"] })}>
              <option value="terbaru">Terbaru diperbarui</option>
              {RANKING.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>

      <div role="radiogroup" aria-label="Kategori" className="mt-4 flex flex-wrap gap-2">
        {PILIHAN_KATEGORI.map((k) => {
          const dipilih = filter.kategori === k.id;
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={dipilih}
              onClick={() => ubah({ kategori: k.id })}
              className={cn(
                "border-2 px-4 py-1.5 text-sm font-semibold transition-colors",
                dipilih
                  ? "border-km-blue bg-km-blue text-white"
                  : "border-km-navy/15 bg-white text-km-navy hover:border-km-navy/40",
              )}
            >
              {k.labelPendek}
            </button>
          );
        })}
      </div>
    </div>
  );
}
