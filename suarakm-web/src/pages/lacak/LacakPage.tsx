import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { FileQuestion, Lock, Search } from "lucide-react";
import { Button, ButtonLink, Card, Container, Input, PageHeader, Skeleton } from "@/components/ui";
import { LatarPastel } from "@/components/decor/Ornamen";
import { TrackingResult } from "@/features/tracking/components/TrackingResult";
import { q } from "@/services/queries";

const CONTOH = ["KM-2026-0412", "KM-2026-0388"];
const normalisasi = (s: string) => s.trim().toUpperCase().replace(/^#/, "");

export default function LacakPage() {
  const [params, setParams] = useSearchParams();
  const idAktif = normalisasi(params.get("id") ?? "");
  const [nilai, setNilai] = useState(idAktif);
  useEffect(() => setNilai(idAktif), [idAktif]);

  const { data, isFetching, isFetched } = useQuery(q.tracking(idAktif));

  const cari = (e: FormEvent) => {
    e.preventDefault();
    const id = normalisasi(nilai);
    setParams(id ? { id } : {});
  };

  return (
    <>
      <PageHeader
        judul="Lacak Laporan"
        label="KM Lapor!"
        deskripsi="Masukkan Report ID yang kamu terima setelah mengirim laporan untuk melihat statusnya."
      />

      <LatarPastel className="mt-10" ornamen={false}>
        <Container className="max-w-4xl py-12 pb-24">
          <Card className="mx-auto max-w-2xl p-5 sm:p-6">
            <form onSubmit={cari} className="flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">Report ID</span>
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-km-navy/60" aria-hidden />
                <Input
                  value={nilai}
                  onChange={(e) => setNilai(e.target.value)}
                  placeholder="#KM-2026-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className="pl-11 font-semibold tracking-wide uppercase placeholder:font-normal placeholder:normal-case"
                />
              </label>
              <Button type="submit" ukuran="md" className="h-12 px-8" disabled={!nilai.trim()}>
                Lacak
              </Button>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span>Coba ID contoh:</span>
              {CONTOH.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setParams({ id })}
                  className="border border-km-blue px-2.5 py-1 font-ui text-xs font-semibold text-km-blue hover:bg-km-blue hover:text-white"
                >
                  {id}
                </button>
              ))}
            </div>
          </Card>

          <div className="mt-10" aria-live="polite">
            {isFetching && !data ? (
              <Skeleton className="h-72" />
            ) : data ? (
              <TrackingResult data={data} />
            ) : idAktif && isFetched ? (
              <Card className="flex flex-col items-center px-6 py-14 text-center">
                <FileQuestion className="size-10 text-km-blue" aria-hidden />
                <p className="mt-4 text-lg font-semibold">Laporan #{idAktif} tidak ditemukan</p>
                <p className="mt-1 max-w-md text-tinta-700">
                  Periksa formatnya (KM-tahun-4 angka) dan pastikan tidak ada huruf yang tertukar. Report ID juga dikirim ke email yang
                  kamu pakai saat melapor.
                </p>
                <ButtonLink to="/lapor" varian="garis" className="mt-6">
                  Buat laporan baru
                </ButtonLink>
              </Card>
            ) : null}
          </div>

          <p className="mx-auto mt-8 flex max-w-xl items-start justify-center gap-2 text-center text-sm text-tinta-700">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            Laporan yang belum terverifikasi tidak tampil di halaman publik. Hanya kamu yang bisa melihat statusnya lewat Report ID.
          </p>
        </Container>
      </LatarPastel>
    </>
  );
}
