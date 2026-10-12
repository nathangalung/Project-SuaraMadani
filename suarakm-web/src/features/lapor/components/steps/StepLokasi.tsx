import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { PROVINSI } from "@/constants/regions";
import type { LaporInput } from "../../types";
import { Catatan } from "../Grup";

type StatusGps = "idle" | "mencari" | "berhasil" | "ditolak" | "tidak-didukung" | "gagal";

const PESAN_GAGAL: Partial<Record<StatusGps, string>> = {
  ditolak: "Akses lokasi ditolak. Izinkan lokasi di pengaturan browser, atau isi lokasi secara manual di bawah.",
  "tidak-didukung": "Browser ini tidak mendukung deteksi lokasi. Isi lokasi secara manual di bawah.",
  gagal: "Lokasi tidak berhasil dideteksi. Coba lagi di area dengan sinyal lebih baik, atau isi secara manual.",
};

/**
 * MOCK reverse-geocoding. Saat backend siap, ganti dengan panggilan API wilayah
 * yang mengubah koordinat menjadi provinsi/kab/kec/kel.
 */
async function reverseGeocodeMock(_lat: number, _lng: number) {
  await new Promise((r) => setTimeout(r, 500));
  return { provinsiId: "jabar", kabupaten: "Kota Bandung", kecamatan: "Coblong", kelurahan: "Lebak Siliwangi" };
}

export function StepLokasi() {
  const {
    register,
    setValue,
    formState: { errors },
  } = useFormContext<LaporInput>();
  const [status, setStatus] = useState<StatusGps>("idle");

  const deteksi = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("tidak-didukung");
      return;
    }
    setStatus("mencari");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const w = await reverseGeocodeMock(lat, lng);
        const opsi = { shouldValidate: true, shouldDirty: true } as const;
        setValue("koordinat", { lat, lng });
        setValue("sumberLokasi", "gps");
        setValue("provinsiId", w.provinsiId, opsi);
        setValue("kabupaten", w.kabupaten, opsi);
        setValue("kecamatan", w.kecamatan, opsi);
        setValue("kelurahan", w.kelurahan, opsi);
        setStatus("berhasil");
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "ditolak" : "gagal"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-2">
        <Button varian="garis" onClick={deteksi} disabled={status === "mencari"}>
          {status === "mencari" && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {status === "mencari" ? "Mendeteksi…" : "Gunakan lokasi saya"}
        </Button>
        <p className="text-sm text-tinta-600">Mengisi provinsi sampai kelurahan dari lokasi perangkatmu, atau isi manual di bawah.</p>
      </div>

      <div aria-live="polite">
        {status === "berhasil" && (
          <Catatan nada="mint">
            <strong className="font-semibold">Lokasi terdeteksi otomatis</strong> — periksa dan koreksi bila tidak sesuai.
          </Catatan>
        )}
        {PESAN_GAGAL[status] && (
          <div role="alert" className="flex gap-3 border-l-4 border-km-red bg-merah-100 p-4 text-sm text-merah-900">
            <CircleAlert className="mt-0.5 size-[1.1rem] shrink-0" aria-hidden />
            {PESAN_GAGAL[status]}
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Provinsi" htmlFor="provinsiId" wajib galat={errors.provinsiId?.message}>
          <Select id="provinsiId" aria-invalid={!!errors.provinsiId} {...register("provinsiId")}>
            <option value="">Pilih provinsi</option>
            {PROVINSI.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nama}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kabupaten/Kota" htmlFor="kabupaten" wajib galat={errors.kabupaten?.message}>
          <Input id="kabupaten" placeholder="Contoh: Kota Bandung" aria-invalid={!!errors.kabupaten} {...register("kabupaten")} />
        </Field>
        <Field label="Kecamatan" htmlFor="kecamatan" wajib galat={errors.kecamatan?.message}>
          <Input id="kecamatan" placeholder="Contoh: Coblong" aria-invalid={!!errors.kecamatan} {...register("kecamatan")} />
        </Field>
        <Field label="Kelurahan/Desa" htmlFor="kelurahan" galat={errors.kelurahan?.message}>
          <Input id="kelurahan" placeholder="Opsional" {...register("kelurahan")} />
        </Field>
      </div>

      <Catatan nada="biru">
        Titik lokasi presisi hanya dipakai tim verifikasi dan <strong className="font-semibold">tidak pernah ditampilkan publik</strong>. Di
        peta publik, laporan digabung per Provinsi › Kabupaten/Kota › Kecamatan.
      </Catatan>
    </div>
  );
}
