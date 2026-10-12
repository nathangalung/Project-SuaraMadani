import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Building2, ChevronLeft, FileText, Lock, MapPin, Share2 } from "lucide-react";
import { ButtonLink, Card, Container, KategoriBadge, Label, PitaJudul, Skeleton, StatusBadge, UrgensiBadge, kelasTombol } from "@/components/ui";
import { LatarPastel, Pita } from "@/components/decor/Ornamen";
import { StatusTracker } from "@/features/issues/components/StatusTracker";
import { Timeline } from "@/features/issues/components/Timeline";
import { EvaluasiPublik } from "@/features/issues/components/EvaluasiPublik";
import { DukungButton } from "@/features/issues/components/DukungButton";
import { Indikator } from "@/features/issues/components/TuntutanIndikator";
import { q } from "@/services/queries";
import { formatAngka, formatTanggalPanjang, hariSejak } from "@/lib/format";
import type { PublicIssue } from "@/types/domain";

export default function IsuDetailPage() {
  const { id = "" } = useParams();
  const { data: isu, isLoading } = useQuery(q.issue(id));

  if (isLoading) {
    return (
      <Container className="py-12">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-6 h-14 w-3/4" />
        <Skeleton className="mt-4 h-20 w-full" />
        <Skeleton className="mt-8 h-48 w-full" />
      </Container>
    );
  }

  if (!isu) {
    return (
      <>
        <PitaJudul>Isu tidak ditemukan</PitaJudul>
        <Container className="py-20 text-center">
          <p className="mx-auto max-w-md text-lg">
            Tidak ada isu dengan kode <strong className="font-semibold">{id}</strong>. Periksa kembali tautannya, atau cari dari daftar isu.
          </p>
          <ButtonLink to="/jelajah" className="mt-8">
            Jelajah isu
          </ButtonLink>
        </Container>
      </>
    );
  }

  return <DetailIsu isu={isu} />;
}

function DetailIsu({ isu }: { isu: PublicIssue }) {
  const { data: semuaTuntutan } = useQuery({ ...q.tuntutan(), enabled: !!isu.tuntutanId });
  const tuntutan = semuaTuntutan?.find((t) => t.id === isu.tuntutanId);

  const bagikan = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: isu.judul, url }).catch(() => {});
    else await navigator.clipboard?.writeText(url);
  };

  const stat = [
    { nilai: formatAngka(isu.jumlahLaporan), label: "Laporan", ket: `Gabungan dari ${formatAngka(isu.jumlahLaporan)} laporan serupa` },
    { nilai: formatAngka(isu.estimasiTerdampak), label: "Estimasi terdampak", ket: "Perkiraan warga yang terdampak" },
    { nilai: formatAngka(isu.dukungan), label: "Dukungan", ket: "Warga yang mendukung isu ini" },
    {
      nilai: formatAngka(hariSejak(isu.dibuat)),
      label: isu.status === "selesai" ? "Hari tercatat" : "Hari belum selesai",
      ket: `Sejak ${formatTanggalPanjang(isu.dibuat)}`,
    },
  ];

  return (
    <>
      <section className="relative isolate overflow-hidden" style={{ background: "linear-gradient(180deg, #eef6c8 0%, #d9f1e6 55%, #c3def6 100%)" }}>
        <Pita className="-z-10 opacity-35" />
        <Container className="relative pt-8 pb-12 sm:pt-10">
          <nav aria-label="Breadcrumb">
            <Link to="/jelajah" className="inline-flex items-center gap-1 text-sm font-semibold hover:underline">
              <ChevronLeft className="size-4" aria-hidden /> Jelajah isu
            </Link>
          </nav>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <KategoriBadge kategori={isu.kategori} />
            <StatusBadge status={isu.status} />
            <UrgensiBadge urgensi={isu.urgensi} />
            <Label warna="krem">{isu.id}</Label>
          </div>

          <h1 className="mt-5 max-w-4xl font-bold text-[clamp(2rem,4.6vw,3.4rem)] leading-[1.08]">{isu.judul}</h1>

          <div className="mt-5 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-6">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4 text-km-blue" aria-hidden />
              {[isu.wilayah.provinsi, isu.wilayah.kabupaten, isu.wilayah.kecamatan].filter(Boolean).join(" · ")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-4 text-km-blue" aria-hidden />
              {isu.instansi}
            </span>
          </div>

          <p className="mt-5 max-w-3xl text-lg leading-relaxed">{isu.ringkasan}</p>

          <div className="mt-7 flex flex-wrap gap-3">
            <DukungButton issueId={isu.id} awal={isu.dukungan} />
            <button type="button" onClick={bagikan} className={kelasTombol("garis", "md", "h-12")}>
              <Share2 className="size-4" aria-hidden /> Bagikan
            </button>
          </div>
        </Container>
      </section>

      <section aria-label="Angka isu" className="relative overflow-hidden bg-km-navy text-white">
        <Container className="py-10">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
            {stat.map((s) => (
              <div key={s.label} className="flex flex-col-reverse border-l-4 border-km-blue pl-4">
                <dt className="mt-2">
                  <span className="block text-white/90">{s.label}</span>
                  <span className="block text-xs leading-snug text-white/65">{s.ket}</span>
                </dt>
                <dd className="font-bold text-[clamp(2rem,4vw,3rem)] leading-none">{s.nilai}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <LatarPastel ornamen={false}>
      <Container className="py-12 pb-24">
        <div className="grid gap-12 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-12">
            <section className="border-t-2 border-km-navy pt-6">
              <h2 className="text-2xl font-bold">Status penanganan</h2>
              <StatusTracker status={isu.status} className="mt-6" />
            </section>

            <section className="border-t-2 border-km-navy pt-6">
              <h2 className="text-2xl font-bold">Riwayat &amp; respons pemerintah</h2>
              <p className="mt-1 font-ui text-[0.95rem] text-tinta-700">Setiap perubahan status dan respons dicatat beserta sumbernya.</p>
              <Timeline items={isu.timeline} className="mt-6 ml-1.5" />
            </section>
          </div>

          <aside className="space-y-8">
            <EvaluasiPublik issue={isu} />

            {tuntutan && (
              <section className="border-t-2 border-km-navy pt-5">
                <p className="font-ui text-sm font-semibold text-tinta-600">Bagian dari tuntutan</p>
                <div className="mt-2">
                  <p className="text-lg leading-snug font-semibold">{tuntutan.judul}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-tinta-700">{tuntutan.ringkasan}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Indikator ya={tuntutan.direspons} label="Sudah direspons" labelTidak="Belum direspons" />
                    <Indikator ya={tuntutan.dipenuhi} label="Sudah dipenuhi" labelTidak="Belum dipenuhi" />
                  </div>
                  <div className="mt-5 flex flex-col gap-2">
                    <a
                      href={tuntutan.policyBriefUrl}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-km-blue underline-offset-2 hover:underline"
                    >
                      <FileText className="size-4" aria-hidden /> Baca policy brief
                    </a>
                    <Link to="/jelajah?tab=tuntutan" className="text-sm underline-offset-2 hover:underline">
                      Lihat semua tuntutan
                    </Link>
                  </div>
                </div>
              </section>
            )}

            <Card varian="navy" className="flex items-start gap-3 p-5 text-sm leading-relaxed text-white/85">
              <Lock className="mt-0.5 size-4 shrink-0 text-white/80" aria-hidden />
              <p>
                Identitas dan kontak pelapor tidak ditampilkan. Lokasi hanya ditampilkan sampai tingkat kecamatan.{" "}
                <Link to="/tentang" className="text-white underline underline-offset-2">
                  Kebijakan privasi
                </Link>
              </p>
            </Card>

            <section className="border-t-2 border-km-navy pt-5">
              <p className="font-semibold">Mengalami hal yang sama?</p>
              <p className="mt-1 text-sm text-tinta-700">Laporanmu akan diverifikasi lalu digabungkan ke isu ini jika serupa.</p>
              <ButtonLink to="/lapor" className="mt-4 w-full">
                Buat laporan
              </ButtonLink>
            </section>
          </aside>
        </div>
      </Container>
      </LatarPastel>
    </>
  );
}
