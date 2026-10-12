import type { ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import { Pilihan } from "@/components/ui";
import { KATEGORI_MAP } from "@/constants/categories";
import { PROVINSI_MAP } from "@/constants/regions";
import { URGENSI_MAP } from "@/constants/status";
import { formatTanggalPanjang } from "@/lib/format";
import type { KategoriId, Urgensi } from "@/types/domain";
import { ESTIMASI_TERDAMPAK, PERAN_PELAPOR, PERSETUJUAN_AKHIR } from "../../schema";
import type { LaporInput } from "../../types";
import { Grup } from "../Grup";

function Baris({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-tinta-600">{label}</dt>
      <dd className="break-words">{children || <span className="text-tinta-400">—</span>}</dd>
    </div>
  );
}

function Bagian({ judul, langkah, onUbah, children }: { judul: string; langkah: number; onUbah: (i: number) => void; children: ReactNode }) {
  return (
    <section className="border-b border-km-navy/12 py-4 first:pt-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-bold text-lg">{judul}</h3>
        <button
          type="button"
          onClick={() => onUbah(langkah)}
          className="text-sm font-semibold text-km-blue underline underline-offset-4 hover:no-underline"
          aria-label={`Ubah ${judul.toLowerCase()}`}
        >
          Ubah
        </button>
      </div>
      <dl className="flex flex-col gap-2.5">{children}</dl>
    </section>
  );
}

export function StepKirim({ onUbah, galatKirim }: { onUbah: (i: number) => void; galatKirim?: string | null }) {
  const {
    register,
    getValues,
    formState: { errors },
  } = useFormContext<LaporInput>();
  const v = getValues();
  const peran = PERAN_PELAPOR.find((p) => p.id === v.peran)?.label;
  const kategori = v.kategori ? KATEGORI_MAP[v.kategori as KategoriId]?.labelPendek : undefined;
  const lokasi = [v.kelurahan, v.kecamatan, v.kabupaten, v.provinsiId ? PROVINSI_MAP[v.provinsiId] : undefined].filter(Boolean).join(", ");
  const estimasi = ESTIMASI_TERDAMPAK.find((e) => e.id === v.estimasiTerdampak)?.label;
  const jmlBerkas = (v.lampiran ?? []).length;
  const jmlTautan = (v.linkSumber ?? []).filter((l) => l.url).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        <Bagian judul="Identitas" langkah={0} onUbah={onUbah}>
          <Baris label="Peran">{peran}</Baris>
        </Bagian>
        <Bagian judul="Lokasi" langkah={1} onUbah={onUbah}>
          <Baris label="Wilayah">{lokasi}</Baris>
          <Baris label="Sumber">{v.sumberLokasi === "gps" ? "Deteksi otomatis (dikoreksi bila perlu)" : "Diisi manual"}</Baris>
        </Bagian>
        <Bagian judul="Detail laporan" langkah={2} onUbah={onUbah}>
          <Baris label="Judul">{v.judul}</Baris>
          <Baris label="Kategori">{[kategori, v.subkategori].filter(Boolean).join(" · ")}</Baris>
          <Baris label="Tanggal">{v.waktuKejadian ? formatTanggalPanjang(`${v.waktuKejadian}T00:00:00`) : ""}</Baris>
          <Baris label="Urgensi">{v.urgensi ? URGENSI_MAP[v.urgensi as Urgensi].label : ""}</Baris>
          {v.instansi && <Baris label="Instansi">{v.instansi}</Baris>}
        </Bagian>
        <Bagian judul="Dampak" langkah={3} onUbah={onUbah}>
          <Baris label="Terdampak">{(v.kelompokTerdampak ?? []).join(", ")}</Baris>
          <Baris label="Perkiraan">{estimasi}</Baris>
          <Baris label="Berlangsung">
            {v.masihBerlangsung === "ya" ? "Masih berlangsung" : v.masihBerlangsung === "tidak" ? "Sudah berhenti" : v.masihBerlangsung ? "Tidak tahu" : ""}
          </Baris>
        </Bagian>
        <Bagian judul="Bukti" langkah={4} onUbah={onUbah}>
          <Baris label="Lampiran">{jmlBerkas || jmlTautan ? `${jmlBerkas} berkas, ${jmlTautan} tautan` : "Tanpa bukti"}</Baris>
        </Bagian>
        <Bagian judul="Kontak" langkah={5} onUbah={onUbah}>
          <Baris label="Dihubungi">
            {v.bersediaDihubungi === "ya" ? `Ya, lewat ${v.metodeKontak ?? "—"}` : v.bersediaDihubungi === "tidak" ? "Tidak" : ""}
          </Baris>
        </Bagian>
      </div>

      <Grup legend="Sebelum mengirim" wajib>
        <div className="grid gap-2.5">
          {PERSETUJUAN_AKHIR.map((p) => {
            const galat = errors.setuju?.[p.id]?.message;
            return (
              <div key={p.id}>
                <Pilihan type="checkbox" label={p.label} aria-invalid={!!galat} {...register(`setuju.${p.id}` as const)} />
                {galat && (
                  <p role="alert" className="mt-1.5 text-sm font-semibold text-km-red">
                    {galat}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Grup>

      {galatKirim && (
        <p role="alert" className="border-l-4 border-km-red bg-merah-100 p-4 text-sm text-merah-900">
          {galatKirim}
        </p>
      )}
    </div>
  );
}
