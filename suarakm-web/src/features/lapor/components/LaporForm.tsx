import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormProvider, useForm, type DefaultValues, type FieldErrors, type Path, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button, ButtonLink, Card, Dialog } from "@/components/ui";
import { KATEGORI_MAP } from "@/constants/categories";
import { useSesi } from "@/features/auth/sesi";
import { submitReport } from "@/services/reports.service";
import type { LaporFormValues, SubmitReportResult } from "@/types/report";
import { bacaDraf, hapusDraf, simpanDraf } from "../draft";
import { FIELD_PER_LANGKAH, LANGKAH, laporSchema } from "../schema";
import type { LaporInput } from "../types";
import { DaftarLangkah, ProgresLangkah } from "./Stepper";
import { SuksesLapor } from "./SuksesLapor";
import { StepBukti } from "./steps/StepBukti";
import { StepDampak } from "./steps/StepDampak";
import { StepDetail } from "./steps/StepDetail";
import { StepIdentitas } from "./steps/StepIdentitas";
import { StepKirim } from "./steps/StepKirim";
import { StepKontak } from "./steps/StepKontak";
import { StepLokasi } from "./steps/StepLokasi";

const TERAKHIR = LANGKAH.length - 1;

/**
 * Radio yang belum dipilih bernilai `null` di react-hook-form, sedangkan pesan
 * `required_error` zod hanya muncul untuk `undefined`. Ubah null → undefined dulu.
 */
const resolverZod = zodResolver(laporSchema);
const resolver: Resolver<LaporInput, unknown, LaporFormValues> = (nilai, ...sisa) =>
  resolverZod(
    Object.fromEntries(Object.entries(nilai).map(([k, v]) => [k, v === null ? undefined : v])) as LaporInput,
    ...sisa,
  );

const NILAI_AWAL = {
  sumberLokasi: "manual",
  provinsiId: "",
  kabupaten: "",
  kecamatan: "",
  kelurahan: "",
  judul: "",
  deskripsi: "",
  subkategori: "",
  waktuKejadian: "",
  instansi: "",
  kelompokTerdampak: [],
  estimasiTerdampak: "",
  dampakKehidupan: "",
  lampiran: [],
  linkSumber: [],
  telepon: "",
  whatsapp: "",
  emailKontak: "",
  izinDihubungi: false,
  keteranganDiwakili: "",
  setuju: { akurat: false, agregat: false, privasi: false, belumVerifikasi: false },
} as unknown as DefaultValues<LaporInput>;

/** Langkah pertama yang memuat field bermasalah */
function langkahDenganGalat(errors: FieldErrors<LaporInput>) {
  const kunci = Object.keys(errors);
  const i = FIELD_PER_LANGKAH.findIndex((daftar) => daftar.some((f) => kunci.includes(f)));
  return i === -1 ? TERAKHIR : i;
}

export function LaporForm() {
  const [draf] = useState(bacaDraf);
  const [langkah, setLangkah] = useState(() => Math.min(draf?.langkah ?? 0, TERAKHIR));
  const [hasil, setHasil] = useState<SubmitReportResult | null>(null);
  const judulRef = useRef<HTMLDivElement>(null);
  const langkahSebelumnya = useRef<number | null>(null);

  const methods = useForm<LaporInput, unknown, LaporFormValues>({
    resolver,
    mode: "onTouched",
    defaultValues: { ...NILAI_AWAL, ...(draf?.nilai as DefaultValues<LaporInput>), lampiran: [] },
  });
  const { trigger, getValues, setError, handleSubmit, watch, reset } = methods;

  const kirim = useMutation({ mutationFn: submitReport });
  // Laporan hanya bisa dikirim setelah masuk; isian tetap bisa diisi dan tersimpan sebagai draf
  const sesi = useSesi();

  // Simpan draf otomatis (tanpa berkas)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const sub = watch((nilai) => {
      clearTimeout(timer);
      timer = setTimeout(() => simpanDraf(nilai as Partial<LaporInput>, langkah), 400);
    });
    return () => {
      clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [watch, langkah]);

  // Fokus ke judul langkah setiap pindah langkah (bukan saat mount pertama; aman untuk StrictMode).
  // Halaman tidak digulir bila judul masih terlihat, supaya kartu tidak bergeser; bila sudah tertutup navbar
  // (langkah sebelumnya panjang), langsung lompat ke atas kartu tanpa animasi.
  useEffect(() => {
    const sebelumnya = langkahSebelumnya.current;
    langkahSebelumnya.current = langkah;
    if (sebelumnya === null || sebelumnya === langkah) return;
    const el = judulRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el.getBoundingClientRect().top < 144) el.scrollIntoView({ behavior: "instant", block: "start" });
  }, [langkah]);

  const pindah = (i: number) => {
    setLangkah(i);
    simpanDraf(getValues(), i);
  };

  /** Aturan kondisional (superRefine baru jalan bila seluruh objek valid, jadi dicek per langkah di sini) */
  const cekKondisional = (i: number) => {
    const v = getValues();
    if (i === 0 && v.peran === "mewakili" && !v.persetujuanDiwakili) {
      setError("persetujuanDiwakili", { type: "custom", message: "Jawab pertanyaan ini dulu." }, { shouldFocus: true });
      return false;
    }
    if (i === 5 && v.bersediaDihubungi === "ya") {
      let ok = true;
      if (!v.telepon && !v.whatsapp && !v.emailKontak) {
        setError("whatsapp", { type: "custom", message: "Isi minimal satu kontak." }, { shouldFocus: true });
        ok = false;
      }
      if (!v.metodeKontak) {
        setError("metodeKontak", { type: "custom", message: "Pilih metode yang kamu sukai." }, { shouldFocus: ok });
        ok = false;
      }
      return ok;
    }
    return true;
  };

  const lanjut = async () => {
    const field = FIELD_PER_LANGKAH[langkah] as unknown as Path<LaporInput>[];
    const valid = await trigger(field, { shouldFocus: true });
    if (!valid || !cekKondisional(langkah)) return;
    pindah(langkah + 1);
  };

  // Data yang sudah valid menunggu konfirmasi di pop-up sebelum dikirim
  const [konfirmasi, setKonfirmasi] = useState<LaporFormValues | null>(null);

  const onValid = (data: LaporFormValues) => {
    if (!sesi) return;
    if (!cekKondisional(0)) return pindah(0);
    if (!cekKondisional(5)) return pindah(5);
    setKonfirmasi(data);
  };

  const kirimSekarang = async () => {
    if (!konfirmasi || !sesi) return;
    const r = await kirim.mutateAsync(konfirmasi).catch(() => null);
    setKonfirmasi(null);
    if (r) {
      hapusDraf();
      setHasil(r);
    }
  };

  const onInvalid = (errors: FieldErrors<LaporInput>) => {
    const i = langkahDenganGalat(errors);
    if (i !== langkah) pindah(i);
  };

  const onSubmit = (e: FormEvent) => {
    if (langkah < TERAKHIR) {
      e.preventDefault();
      void lanjut();
      return;
    }
    void handleSubmit(onValid, onInvalid)(e);
  };

  const mulaiBaru = () => {
    hapusDraf();
    reset(NILAI_AWAL);
    kirim.reset();
    setHasil(null);
    setLangkah(0);
  };

  if (hasil) return <SuksesLapor hasil={hasil} onBaru={mulaiBaru} />;

  const l = LANGKAH[langkah];

  return (
    <FormProvider {...methods}>
      {/* kolom kiri & kartu sama tinggi (stretch); tombol menempel di dasar kartu */}
      <div className="grid gap-10 lg:grid-cols-[14rem_1fr]">
        <div className="hidden lg:block">
          <DaftarLangkah aktif={langkah} onPilih={pindah} />
        </div>
        <div className="flex flex-col">
          <Card className="flex flex-1 flex-col rounded-xl p-5 sm:p-8">
            <div ref={judulRef} tabIndex={-1} className="scroll-mt-36 outline-none">
              <h2 className="text-xl font-bold text-km-navy sm:text-2xl">
                Langkah {langkah + 1} dari {LANGKAH.length}: {l.judul}
              </h2>
              <ProgresLangkah aktif={langkah} />
            </div>

            <form noValidate onSubmit={onSubmit} className="mt-6 flex flex-1 flex-col" aria-label={`Formulir KM Lapor! — ${l.judul}`}>
              {langkah === 0 && <StepIdentitas />}
              {langkah === 1 && <StepLokasi />}
              {langkah === 2 && <StepDetail />}
              {langkah === 3 && <StepDampak />}
              {langkah === 4 && <StepBukti />}
              {langkah === 5 && <StepKontak />}
              {langkah === 6 && (
                <StepKirim
                  onUbah={pindah}
                  galatKirim={kirim.isError ? "Laporan belum terkirim karena koneksi bermasalah. Periksa internetmu, lalu kirim ulang." : null}
                />
              )}

              {langkah === TERAKHIR && !sesi && (
                <p role="status" className="mt-6 border-l-4 border-km-blue bg-biru-100 px-4 py-3 leading-relaxed text-km-navy">
                  <strong>Masuk dulu untuk mengirim laporan.</strong> Isianmu tetap tersimpan sebagai draf di perangkat ini
                  {(getValues("lampiran") ?? []).length > 0 && ", tapi lampiran perlu diunggah ulang setelah masuk"}.
                </p>
              )}

              <div className="mt-auto flex flex-col-reverse gap-3 pt-8 sm:flex-row sm:items-center sm:justify-between">
                {langkah > 0 ? (
                  <Button varian="garis" ukuran="md" onClick={() => pindah(langkah - 1)}>
                    Kembali
                  </Button>
                ) : (
                  <span className="hidden sm:block" />
                )}
                {langkah < TERAKHIR ? (
                  <Button type="submit" varian="gelap" ukuran="md" className="border-2 border-km-navy sm:min-w-32">
                    Lanjut
                  </Button>
                ) : !sesi ? (
                  <ButtonLink to="/masuk?next=/lapor" varian="gelap" ukuran="md" className="border-2 border-km-navy sm:min-w-32" onClick={() => simpanDraf(getValues(), langkah)}>
                    Masuk untuk mengirim
                  </ButtonLink>
                ) : (
                  <Button type="submit" varian="gelap" ukuran="md" className="border-2 border-km-navy sm:min-w-32" disabled={kirim.isPending}>
                    {kirim.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
                    {kirim.isPending ? "Mengirim laporan…" : "Kirim laporan"}
                  </Button>
                )}
              </div>
            </form>
          </Card>
        </div>
      </div>
      <p className="mt-3 text-center text-sm text-tinta-600 lg:ml-[16.5rem]">Draf tersimpan otomatis di perangkat ini.</p>

      <Dialog
        buka={konfirmasi !== null}
        onTutup={() => !kirim.isPending && setKonfirmasi(null)}
        judul="Kirim laporan ini?"
        aksi={
          <>
            <Button varian="garis" onClick={() => setKonfirmasi(null)} disabled={kirim.isPending}>
              Periksa lagi
            </Button>
            <Button onClick={() => void kirimSekarang()} disabled={kirim.isPending}>
              {kirim.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
              {kirim.isPending ? "Mengirim…" : "Ya, kirim laporan"}
            </Button>
          </>
        }
      >
        {konfirmasi && (
          <>
            <p className="font-semibold text-km-navy">“{konfirmasi.judul}”</p>
            <p className="mt-1 font-ui text-sm">
              {KATEGORI_MAP[konfirmasi.kategori].labelPendek} · {konfirmasi.subkategori} · {konfirmasi.kabupaten}
            </p>
            <p className="mt-4">
              Laporan akan diverifikasi tim sebelum tampil sebagai isu publik. Identitas dan kontakmu tidak ditampilkan.
            </p>
          </>
        )}
      </Dialog>
    </FormProvider>
  );
}
