import { useFormContext } from "react-hook-form";
import { Field, Select, Textarea } from "@/components/ui";
import { ESTIMASI_TERDAMPAK, KELOMPOK_TERDAMPAK } from "../../schema";
import type { LaporInput } from "../../types";
import { Grup, Segmen } from "../Grup";

const BERLANGSUNG = [
  { id: "ya", label: "Ya, masih berlangsung" },
  { id: "tidak", label: "Sudah berhenti" },
  { id: "tidak-tahu", label: "Tidak tahu" },
] as const;

export function StepDampak() {
  const {
    register,
    formState: { errors },
  } = useFormContext<LaporInput>();

  return (
    <div className="flex flex-col gap-6">
      <Grup
        legend="Siapa yang terdampak?"
        bantuan="Boleh pilih lebih dari satu."
        galat={errors.kelompokTerdampak?.message}
        wajib
      >
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {KELOMPOK_TERDAMPAK.map((k) => (
            <Segmen
              key={k}
              label={k}
              input={<input type="checkbox" className="sr-only" value={k} {...register("kelompokTerdampak")} />}
            />
          ))}
        </div>
      </Grup>

      <Field label="Perkiraan jumlah warga terdampak" htmlFor="estimasiTerdampak" wajib galat={errors.estimasiTerdampak?.message}>
        <Select id="estimasiTerdampak" aria-invalid={!!errors.estimasiTerdampak} {...register("estimasiTerdampak")}>
          <option value="">Pilih perkiraan</option>
          {ESTIMASI_TERDAMPAK.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Dampak terhadap kehidupan masyarakat"
        htmlFor="dampakKehidupan"
        wajib
        bantuan="Contoh: anak-anak tidak bisa sekolah, warga harus membeli air galon setiap hari."
        galat={errors.dampakKehidupan?.message}
      >
        <Textarea id="dampakKehidupan" rows={4} aria-invalid={!!errors.dampakKehidupan} {...register("dampakKehidupan")} />
      </Field>

      <Grup legend="Apakah masalah ini masih berlangsung?" galat={errors.masihBerlangsung?.message} wajib>
        <div className="grid gap-2 sm:grid-cols-3">
          {BERLANGSUNG.map((b) => (
            <Segmen
              key={b.id}
              label={b.label}
              input={<input type="radio" className="sr-only" value={b.id} aria-invalid={!!errors.masihBerlangsung} {...register("masihBerlangsung")} />}
            />
          ))}
        </div>
      </Grup>
    </div>
  );
}
