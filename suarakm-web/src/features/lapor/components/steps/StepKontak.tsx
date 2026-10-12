import { useFormContext } from "react-hook-form";
import { Field, Input, Pilihan } from "@/components/ui";
import { METODE_KONTAK } from "../../schema";
import type { LaporInput } from "../../types";
import { Catatan, Grup, Segmen } from "../Grup";

export function StepKontak() {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<LaporInput>();
  const bersedia = watch("bersediaDihubungi");

  return (
    <div className="flex flex-col gap-6">
      <Grup legend="Apakah kamu bersedia dihubungi lebih lanjut?" galat={errors.bersediaDihubungi?.message} wajib>
        <div className="grid gap-3 sm:grid-cols-2">
          <Pilihan
            value="ya"
            label="Ya, boleh dihubungi"
            deskripsi="Membantu tim memverifikasi lebih cepat."
            aria-invalid={!!errors.bersediaDihubungi}
            {...register("bersediaDihubungi")}
          />
          <Pilihan
            value="tidak"
            label="Tidak"
            deskripsi="Laporan tetap diproses tanpa kontak."
            aria-invalid={!!errors.bersediaDihubungi}
            {...register("bersediaDihubungi")}
          />
        </div>
      </Grup>

      {bersedia === "ya" && (
        <div className="flex flex-col gap-5 border-l-4 border-km-blue bg-km-cream p-4 sm:p-5">
          <p className="text-sm text-tinta-600">Isi minimal satu kontak.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="WhatsApp" htmlFor="whatsapp" galat={errors.whatsapp?.message}>
              <Input id="whatsapp" type="tel" inputMode="tel" autoComplete="tel" placeholder="08xx xxxx xxxx" aria-invalid={!!errors.whatsapp} {...register("whatsapp")} />
            </Field>
            <Field label="Nomor telepon" htmlFor="telepon" galat={errors.telepon?.message}>
              <Input id="telepon" type="tel" inputMode="tel" placeholder="Jika berbeda dari WhatsApp" {...register("telepon")} />
            </Field>
            <Field label="Email" htmlFor="emailKontak" galat={errors.emailKontak?.message} className="sm:col-span-2">
              <Input id="emailKontak" type="email" autoComplete="email" placeholder="nama@email.com" aria-invalid={!!errors.emailKontak} {...register("emailKontak")} />
            </Field>
          </div>

          <Grup legend="Metode komunikasi yang kamu sukai" galat={errors.metodeKontak?.message} wajib>
            <div className="grid grid-cols-3 gap-2">
              {METODE_KONTAK.map((m) => (
                <Segmen
                  key={m}
                  label={m}
                  input={<input type="radio" className="sr-only" value={m} aria-invalid={!!errors.metodeKontak} {...register("metodeKontak")} />}
                />
              ))}
            </div>
          </Grup>

          <Pilihan
            type="checkbox"
            label="Saya mengizinkan KM ITB menghubungi saya untuk verifikasi atau tindak lanjut laporan."
            {...register("izinDihubungi")}
          />
        </div>
      )}

      <Catatan>
        Informasi kontak <strong className="font-semibold">tidak ditampilkan secara publik</strong> dan hanya dipakai tim KM ITB untuk
        verifikasi atau tindak lanjut laporan.
      </Catatan>
    </div>
  );
}
