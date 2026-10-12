import { useQuery } from "@tanstack/react-query";
import { Container, PageHeader, SectionHeading, Skeleton } from "@/components/ui";
import { BintangKuning, LatarPastel } from "@/components/decor/Ornamen";
import { formatAngka, formatTanggalPanjang } from "@/lib/format";
import { q } from "@/services/queries";
import { CategoryBreakdown } from "@/features/dashboard/CategoryBreakdown";
import { SkeletonBarisAtas, SkeletonStat } from "@/features/dashboard/DashboardSkeleton";
import { IssueRanking } from "@/features/dashboard/IssueRanking";
import { ResponseRate } from "@/features/dashboard/ResponseRate";
import { SatisfactionPanel } from "@/features/dashboard/SatisfactionPanel";
import { StatTile } from "@/features/dashboard/StatTile";
import { StatusFlow } from "@/features/dashboard/StatusFlow";
import { TrendChart } from "@/features/dashboard/TrendChart";
import { TuntutanBoard } from "@/features/dashboard/TuntutanBoard";
import { MapExplorer } from "@/features/map/MapExplorer";

export default function DashboardPage() {
  const statistik = useQuery(q.statistik());
  const provinsi = useQuery(q.provinsi());
  const tren = useQuery(q.tren());
  const kepuasan = useQuery(q.kepuasan());
  const headline = useQuery(q.headline());
  const tuntutan = useQuery(q.tuntutan());

  const s = statistik.data;

  return (
    <>
      <PageHeader
        judul="Dashboard Nasional"
        label={s ? `Data contoh · diperbarui ${formatTanggalPanjang(s.diperbarui)}` : "Data contoh"}
        deskripsi="Pantau laporan warga, isu yang sedang dikawal, dan sejauh mana pemerintah merespons tuntutan publik."
      />

      {/* Baris atas wireframe: Xx% · Tuntutan · Kepuasan/headline */}
      <Container className="pt-10 pb-8">
        <h2 className="sr-only">Ringkasan</h2>
        {s && tuntutan.data && kepuasan.data && headline.data ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,340px)]">
            <ResponseRate s={s} />
            <TuntutanBoard data={tuntutan.data} />
            <div className="md:col-span-2 lg:col-span-1">
              <SatisfactionPanel s={s} sebaran={kepuasan.data} headline={headline.data} />
            </div>
          </div>
        ) : (
          <SkeletonBarisAtas />
        )}
      </Container>

      {/* Statistik utama (§6) — gaya angka band biru laut */}
      <section aria-labelledby="judul-angka" className="relative isolate overflow-hidden bg-km-navy text-white">
        <Container className="py-12">
          <h2 id="judul-angka" className="font-bold text-3xl sm:text-4xl">
            Angka utama
          </h2>
          {s ? (
            <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
              {[
                { label: "Total laporan", nilai: formatAngka(s.totalLaporan) },
                {
                  label: "Laporan terverifikasi",
                  nilai: formatAngka(s.laporanTerverifikasi),
                  ket: `${Math.round((s.laporanTerverifikasi / s.totalLaporan) * 100)}% dari total`,
                },
                { label: "Isu aktif", nilai: formatAngka(s.isuAktif) },
                { label: "Isu telah direspons", nilai: formatAngka(s.telahDirespons) },
                { label: "Total tuntutan", nilai: formatAngka(s.totalTuntutan) },
                { label: "Tuntutan dalam proses", nilai: formatAngka(s.tuntutanDiproses) },
                { label: "Tuntutan selesai", nilai: formatAngka(s.tuntutanSelesai) },
                { label: "Wilayah laporan terbanyak", nilai: s.wilayahTerbanyak, kecil: true },
              ].map((t) => (
                <StatTile key={t.label} label={t.label} nilai={t.nilai} keterangan={t.ket} kecil={t.kecil} />
              ))}
            </dl>
          ) : (
            <SkeletonStat />
          )}
        </Container>
      </section>

      {/* Peta isu nasional (§20) — band biru laut km.itb.ac.id */}
      <section aria-labelledby="judul-peta" className="relative isolate overflow-hidden bg-km-navy pt-4 pb-16 sm:pb-20">
        <BintangKuning className="top-6 right-[3%] hidden w-20 xl:block" />
        <Container className="relative">
          <SectionHeading
            id="judul-peta"
            judul="Peta isu"
            gelap
            className="mb-10 [&>p]:text-white/85"
            deskripsi="Ukuran gelembung mengikuti jumlah laporan per provinsi. Pilih kategori, status, atau wilayah untuk menyaring."
          />
          {provinsi.data ? <MapExplorer data={provinsi.data} /> : <Skeleton className="h-[520px] bg-white/10" />}
        </Container>
      </section>

      <LatarPastel ornamen={false}>
        {/* Grafik */}
        <Container className="py-16 sm:py-20">
          <SectionHeading
            judul="Tren laporan"
            deskripsi="Setiap grafik punya tampilan tabel untuk dibaca tanpa warna."
            className="mb-10"
          />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {tren.data ? <TrendChart data={tren.data} /> : <Skeleton className="h-[400px]" />}
            <div className="flex flex-col gap-6">
              {provinsi.data ? (
                <>
                  <CategoryBreakdown data={provinsi.data} />
                  <StatusFlow data={provinsi.data} />
                </>
              ) : (
                <Skeleton className="h-[400px]" />
              )}
            </div>
          </div>
        </Container>

        {/* Peringkat isu (§21) */}
        <Container className="pb-20">
          <SectionHeading
            judul="Peringkat isu"
            deskripsi="Bandingkan isu dari jumlah laporan, urgensi, dampak, dukungan, kepuasan, dan lama penanganan."
            className="mb-10"
          />
          <IssueRanking />
        </Container>
      </LatarPastel>
    </>
  );
}
