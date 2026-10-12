import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, ButtonLink, Card, LabelLaporan, Nomor, useToast } from "@/components/ui";
import { formatTanggal } from "@/lib/format";
import type { SubmitReportResult } from "@/types/report";

const LANGKAH_BERIKUT = [
  { judul: "Verifikasi", isi: "Tim memeriksa laporan dan bukti dalam 1–3 hari kerja. Kami menghubungimu bila diizinkan." },
  { judul: "Pengelompokan isu", isi: "Laporan serupa di wilayah yang sama digabung menjadi satu isu publik." },
  { judul: "Dipantau bersama", isi: "Perkembangan, respons pemerintah, dan penilaian publik tampil di halaman isu." },
];

export function SuksesLapor({ hasil, onBaru }: { hasil: SubmitReportResult; onBaru: () => void }) {
  const [tersalin, setTersalin] = useState(false);
  const toast = useToast();
  const judulRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    judulRef.current?.focus();
  }, []);

  const salin = async () => {
    try {
      await navigator.clipboard.writeText(hasil.reportId);
      setTersalin(true);
      toast(`Nomor laporan #${hasil.reportId} disalin`);
      setTimeout(() => setTersalin(false), 2000);
    } catch {
      setTersalin(false);
    }
  };

  return (
    <div className="relative mx-auto max-w-3xl">

      <div ref={judulRef} tabIndex={-1} className="outline-none">
        <h2 className="text-center font-judul text-[clamp(2rem,6vw,3rem)] text-km-navy">Laporan diterima</h2>
      </div>
      <p className="mt-5 text-center text-lg">Laporan berhasil diterima. Simpan nomor ini untuk memantau perkembangannya — tanpa perlu masuk.</p>

      <div className="mt-10 flex flex-col items-center gap-5">
        <output aria-live="polite" className="contents">
          <LabelLaporan
            reportId={hasil.reportId}
            baris={[
              { label: "Tanggal", nilai: formatTanggal(hasil.diterima) },
              { label: "Status", nilai: "Menunggu verifikasi" },
            ]}
          />
        </output>
        <Button varian="garis" ukuran="sm" onClick={salin}>
          {tersalin ? <Check className="size-4 text-km-green" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {tersalin ? "Tersalin" : "Salin nomor laporan"}
        </Button>
      </div>

      <Card className="mt-6 p-6 sm:p-8">
        <h3 className="font-bold text-2xl">Selanjutnya</h3>
        <ol className="mt-5 flex flex-col gap-5">
          {LANGKAH_BERIKUT.map((l, i) => (
            <li key={l.judul} className="flex gap-4">
              <Nomor>{i + 1}</Nomor>
              <div>
                <p className="font-semibold">{l.judul}</p>
                <p className="text-sm leading-relaxed text-tinta-600">{l.isi}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <ButtonLink to={`/lacak?id=${encodeURIComponent(hasil.reportId)}`} ukuran="lg">
          Lacak laporan
        </ButtonLink>
        <ButtonLink to="/jelajah" varian="garis" ukuran="lg">
          Jelajah isu
        </ButtonLink>
        <Button varian="hantu" ukuran="lg" onClick={onBaru}>
          Buat laporan lain
        </Button>
      </div>
    </div>
  );
}
