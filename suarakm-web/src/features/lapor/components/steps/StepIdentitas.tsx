import { useFormContext } from "react-hook-form";
import { Field, Input, Pilihan } from "@/components/ui";
import { PERAN_PELAPOR, PERSETUJUAN_DIWAKILI } from "../../schema";
import type { LaporInput } from "../../types";
import { Catatan, Grup } from "../Grup";

const DESKRIPSI_PERAN: Record<(typeof PERAN_PELAPOR)[number]["id"], string> = {
  korban: "Kamu mengalami persoalan ini secara langsung.",
  mewakili: "Misalnya keluarga, pendamping, atau pengurus komunitas korban.",
  saksi: "Kamu melihat atau mengetahui kejadiannya, tapi tidak terdampak langsung.",
};

export function StepIdentitas() {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<LaporInput>();
  const peran = watch("peran");

  return (
    <div className="flex flex-col gap-6">
      <Grup legend="Siapa kamu dalam laporan ini?" galat={errors.peran?.message} wajib>
        <div className="grid gap-3">
          {PERAN_PELAPOR.map((p) => (
            <Pilihan
              key={p.id}
              value={p.id}
              label={p.label}
              deskripsi={DESKRIPSI_PERAN[p.id]}
              aria-invalid={!!errors.peran}
              {...register("peran")}
            />
          ))}
        </div>
      </Grup>

      {peran === "mewakili" && (
        <div className="flex flex-col gap-5 border-l-4 border-km-blue bg-km-cream p-4 sm:p-5">
          <Grup
            legend="Apakah kamu punya persetujuan atau hubungan dengan korban/pelapor yang kamu wakili?"
            galat={errors.persetujuanDiwakili?.message}
            wajib
          >
            <div className="grid gap-3">
              {PERSETUJUAN_DIWAKILI.map((p) => (
                <Pilihan
                  key={p.id}
                  value={p.id}
                  label={p.label}
                  aria-invalid={!!errors.persetujuanDiwakili}
                  {...register("persetujuanDiwakili")}
                />
              ))}
            </div>
          </Grup>
          <Field
            label="Keterangan singkat tentang pihak yang diwakili (opsional)"
            htmlFor="keteranganDiwakili"
            bantuan="Contoh: ibu saya, warga RW 05 yang saya dampingi."
            galat={errors.keteranganDiwakili?.message}
          >
            <Input id="keteranganDiwakili" maxLength={200} {...register("keteranganDiwakili")} />
          </Field>
          <Catatan>
            Informasi tentang pihak yang kamu wakili hanya dipakai tim verifikasi dan tidak dipublikasikan.
          </Catatan>
        </div>
      )}
    </div>
  );
}
