import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Lock, MailCheck } from "lucide-react";
import { requestOtp, verifyOtp } from "@/services/auth.service";
import { Button, Card, Field, Input } from "@/components/ui";
import { simpanSesi } from "@/features/auth/sesi";

/** Alur MVP (PDF §8): email terverifikasi → akun → verifikasi tambahan opsional */
export default function MasukPage() {
  const [params] = useSearchParams();
  const lanjut = params.get("next") ?? "/lapor";
  const daftar = params.get("mode") === "daftar";
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [kode, setKode] = useState("");
  const [galat, setGalat] = useState<string>();

  const kirim = useMutation({ mutationFn: requestOtp, onError: () => setGalat("Kode gagal dikirim. Periksa koneksi lalu coba lagi.") });
  const verif = useMutation({
    mutationFn: () => verifyOtp(email, kode),
    onSuccess: (r) => {
      if (!r.ok) return setGalat("Kode salah atau kedaluwarsa. Periksa email terbaru lalu masukkan ulang.");
      simpanSesi(email);
      navigate(lanjut);
    },
  });

  const tahapKode = kirim.isSuccess;

  const kirimEmail = (e: FormEvent) => {
    e.preventDefault();
    setGalat(undefined);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setGalat("Masukkan alamat email yang valid, mis. nama@email.com.");
    kirim.mutate(email);
  };

  const kirimKode = (e: FormEvent) => {
    e.preventDefault();
    setGalat(undefined);
    if (!/^\d{6}$/.test(kode)) return setGalat("Kode terdiri dari 6 angka.");
    verif.mutate();
  };

  return (
    <Card className="w-full max-w-md border-t-[6px] border-km-blue p-7 sm:p-9">
      {!tahapKode ? (
        <form onSubmit={kirimEmail} noValidate>
          <h1 className="font-judul text-4xl">{daftar ? "Buat akun" : "Masuk"}</h1>
          <p className="mt-2 leading-relaxed text-tinta-600">
            {daftar
              ? "Buat akun dengan email terverifikasi. Laporanmu jadi bisa dilacak dan suaramu dihitung satu kali. Tidak perlu NIK atau kata sandi."
              : "Masuk dengan email supaya laporanmu bisa dilacak dan suaramu dihitung satu kali. Tidak perlu kata sandi."}
          </p>
          <Field label="Email" htmlFor="email" galat={galat} className="mt-6">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="nama@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!galat}
              autoFocus
            />
          </Field>
          <Button type="submit" className="mt-5 w-full" ukuran="lg" disabled={kirim.isPending}>
            {kirim.isPending ? "Mengirim kode…" : daftar ? "Kirim kode verifikasi" : "Kirim kode masuk"}
          </Button>
          <p className="mt-4 text-center text-sm">
            {daftar ? "Sudah punya akun? " : "Belum punya akun? "}
            <Link to={daftar ? "/masuk" : "/masuk?mode=daftar"} className="font-semibold text-km-blue underline underline-offset-4 hover:no-underline">
              {daftar ? "Masuk" : "Buat akun"}
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={kirimKode} noValidate>
          <button
            type="button"
            onClick={() => {
              kirim.reset();
              setKode("");
              setGalat(undefined);
            }}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-tinta-600 hover:text-tinta-900"
          >
            <ArrowLeft className="size-4" aria-hidden /> Ganti email
          </button>
          <span className="grid size-12 place-items-center bg-km-blue">
            <MailCheck className="size-6 text-white" aria-hidden />
          </span>
          <h1 className="mt-4 font-judul text-4xl">Cek email</h1>
          <p className="mt-2 leading-relaxed text-tinta-600">
            Kode 6 angka sudah dikirim ke <strong className="text-tinta-900">{email}</strong>. Kode berlaku 10 menit.
          </p>
          <Field label="Kode masuk" htmlFor="kode" galat={galat} className="mt-6">
            <Input
              id="kode"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={kode}
              onChange={(e) => setKode(e.target.value.replace(/\D/g, ""))}
              aria-invalid={!!galat}
              className="text-center font-bold text-2xl tracking-[0.5em]"
              autoFocus
            />
          </Field>
          <Button type="submit" className="mt-5 w-full" ukuran="lg" disabled={verif.isPending}>
            {verif.isPending ? "Memeriksa…" : "Masuk"}
          </Button>
          <button
            type="button"
            className="mt-3 w-full text-sm font-semibold text-km-blue hover:underline disabled:opacity-50"
            onClick={() => kirim.mutate(email)}
            disabled={kirim.isPending}
          >
            Kirim ulang kode
          </button>
          <p className="mt-4 border-l-4 border-km-blue bg-biru-100 px-3 py-2 text-xs text-km-navy">Mode demo: kode 6 angka apa pun diterima.</p>
        </form>
      )}

      <p className="mt-7 flex gap-2 border-t border-km-navy/10 pt-5 text-sm leading-relaxed text-tinta-700">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Kami tidak meminta NIK untuk melapor. Email dan kontakmu tidak ditampilkan ke publik.{" "}
          <Link to="/tentang#privasi" className="font-semibold text-km-blue hover:underline">
            Kebijakan privasi
          </Link>
        </span>
      </p>
    </Card>
  );
}
