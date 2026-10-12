import type { HeadlineBerita, StatistikNasional, TrenBulanan } from "@/types/domain";

/** DATA CONTOH — angka mengikuti contoh "EXPECTED" di dokumen konsep (§6). */
export const STATISTIK: StatistikNasional = {
  totalLaporan: 12481,
  laporanTerverifikasi: 8932,
  isuAktif: 327,
  telahDirespons: 42,
  totalTuntutan: 18,
  tuntutanDiproses: 11,
  tuntutanSelesai: 4,
  wilayahTerbanyak: "Jawa Barat",
  kepuasanPublik: 2.7,
  jumlahPenilai: 6522,
  tingkatRespons: 12.8,
  diperbarui: "2026-10-10T09:00:00+07:00",
};

export const TREN_BULANAN: TrenBulanan[] = [
  { bulan: "2026-04", masuk: 612, terverifikasi: 401 },
  { bulan: "2026-05", masuk: 948, terverifikasi: 655 },
  { bulan: "2026-06", masuk: 1310, terverifikasi: 902 },
  { bulan: "2026-07", masuk: 1894, terverifikasi: 1340 },
  { bulan: "2026-08", masuk: 2507, terverifikasi: 1822 },
  { bulan: "2026-09", masuk: 3140, terverifikasi: 2361 },
  { bulan: "2026-10", masuk: 2070, terverifikasi: 1451 },
];

/** Sebaran penilaian kepuasan 1–5 (PDF §17) */
export const SEBARAN_KEPUASAN: { skor: number; jumlah: number }[] = [
  { skor: 1, jumlah: 1488 },
  { skor: 2, jumlah: 1702 },
  { skor: 3, jumlah: 1653 },
  { skor: 4, jumlah: 1094 },
  { skor: 5, jumlah: 585 },
];

export const HEADLINE: HeadlineBerita[] = [
  { id: "h1", judul: "PDAM targetkan perbaikan pipa transmisi rampung akhir Oktober", sumber: "Siaran pers instansi", tanggal: "2026-10-06", url: "#", isuId: "ISU-0142" },
  { id: "h2", judul: "Dinas Sosial jadwalkan verifikasi ulang data penerima per desa", sumber: "Rilis pemerintah daerah", tanggal: "2026-09-28", url: "#", isuId: "ISU-0125" },
  { id: "h3", judul: "Bantuan pompa air untuk lima desa terdampak kekeringan", sumber: "Media lokal", tanggal: "2026-09-12", url: "#", isuId: "ISU-0092" },
];
