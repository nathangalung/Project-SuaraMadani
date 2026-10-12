import { useFormContext } from "react-hook-form";
import { Field, Input, Pilihan, Select, Textarea } from "@/components/ui";
import { KATEGORI, KATEGORI_MAP } from "@/constants/categories";
import { URGENSI } from "@/constants/status";
import { cn } from "@/lib/cn";
import type { KategoriId } from "@/types/domain";
import type { LaporInput } from "../../types";
import { Grup, Segmen } from "../Grup";

const hariIni = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD waktu lokal

export function StepDetail() {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<LaporInput>();
  const kategori = watch("kategori") as KategoriId | undefined;
  const panjangJudul = (watch("judul") ?? "").length;

  return (
    <div className="flex flex-col gap-6">
      <Field
        label={
          <span className="flex w-full items-baseline justify-between gap-2">
            <span>
              Judul laporan<span className="ml-0.5 text-km-red" aria-hidden>*</span>
            </span>
            <span className={cn("text-xs font-normal", panjangJudul > 120 ? "text-km-red" : "text-tinta-500")}>
              {panjangJudul}/120
            </span>
          </span>
        }
        htmlFor="judul"
        bantuan="Ringkas dan spesifik. Contoh: “Air PDAM tidak mengalir dua minggu di RW 07”."
        galat={errors.judul?.message}
      >
        <Input id="judul" aria-invalid={!!errors.judul} {...register("judul")} />
      </Field>

      <Field
        label="Deskripsi masalah"
        htmlFor="deskripsi"
        wajib
        bantuan="Ceritakan apa yang terjadi, sejak kapan, dan apa yang sudah dicoba. Hindari menyebut nama atau data pribadi orang lain."
        galat={errors.deskripsi?.message}
      >
        <Textarea id="deskripsi" rows={6} aria-invalid={!!errors.deskripsi} {...register("deskripsi")} />
      </Field>

      <Grup legend="Kategori" galat={errors.kategori?.message} wajib>
        <div className="grid gap-3">
          {KATEGORI.map((k) => (
            <Pilihan
              key={k.id}
              value={k.id}
              aria-invalid={!!errors.kategori}
              label={k.label}
              deskripsi={k.deskripsi}
              {...register("kategori", {
                onChange: () => setValue("subkategori", "", { shouldValidate: false }),
              })}
            />
          ))}
        </div>
      </Grup>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Subkategori" htmlFor="subkategori" wajib galat={errors.subkategori?.message}>
          <Select id="subkategori" disabled={!kategori} aria-invalid={!!errors.subkategori} {...register("subkategori")}>
            <option value="">{kategori ? "Pilih subkategori" : "Pilih kategori dulu"}</option>
            {kategori &&
              KATEGORI_MAP[kategori]?.subkategori.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Tanggal kejadian" htmlFor="waktuKejadian" wajib galat={errors.waktuKejadian?.message}>
          <Input id="waktuKejadian" type="date" max={hariIni()} aria-invalid={!!errors.waktuKejadian} {...register("waktuKejadian")} />
        </Field>
      </div>

      <Field
        label="Instansi pemerintah terkait"
        htmlFor="instansi"
        bantuan="Opsional. Kalau tidak tahu, kosongkan saja — tim akan membantu memetakan."
        galat={errors.instansi?.message}
      >
        <Input id="instansi" placeholder="Contoh: Dinas Sosial Kab. Grobogan" {...register("instansi")} />
      </Field>

      <Grup
        legend="Tingkat urgensi"
        bantuan="Pilih Darurat bila mengancam keselamatan jiwa atau butuh penanganan dalam 24 jam."
        galat={errors.urgensi?.message}
        wajib
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {URGENSI.map((u) => (
            <Segmen
              key={u.id}
              label={u.label}
              input={<input type="radio" className="sr-only" value={u.id} aria-invalid={!!errors.urgensi} {...register("urgensi")} />}
            />
          ))}
        </div>
      </Grup>
    </div>
  );
}
