/** Tiga kategori utama (PDF §9) */
export type KategoriId = "program" | "bencana" | "bansos";

/** Status perkembangan isu (PDF §20) */
export type StatusIsu = "dilaporkan" | "terverifikasi" | "diproses" | "direspons" | "selesai";

export type Urgensi = "rendah" | "sedang" | "tinggi" | "darurat";

export interface Wilayah {
  provinsiId: string;
  provinsi: string;
  kabupaten?: string;
  kecamatan?: string;
  kelurahan?: string;
}

export interface TimelineEvent {
  tanggal: string; // ISO
  status: StatusIsu;
  judul: string;
  keterangan: string;
  sumber?: { label: string; url: string };
}

/** Isu publik = gabungan beberapa laporan serupa (PDF §15) */
export interface PublicIssue {
  id: string;
  judul: string;
  ringkasan: string;
  kategori: KategoriId;
  subkategori: string;
  status: StatusIsu;
  urgensi: Urgensi;
  wilayah: Wilayah;
  instansi: string;
  jumlahLaporan: number;
  estimasiTerdampak: number;
  dukungan: number;
  /** skor 1–5, null bila belum ada penilaian */
  kepuasan: number | null;
  jumlahPenilai: number;
  dibuat: string;
  diperbarui: string;
  tuntutanId?: string;
  timeline: TimelineEvent[];
}

export interface Tuntutan {
  id: string;
  judul: string;
  ringkasan: string;
  policyBriefUrl: string;
  /** pemerintah sudah memberi respons resmi */
  direspons: boolean;
  /** tuntutan sudah dipenuhi/ditindaklanjuti */
  dipenuhi: boolean;
  isuTerkait: string[];
  diajukan: string;
}

export interface StatistikNasional {
  totalLaporan: number;
  laporanTerverifikasi: number;
  isuAktif: number;
  telahDirespons: number;
  totalTuntutan: number;
  tuntutanDiproses: number;
  tuntutanSelesai: number;
  wilayahTerbanyak: string;
  kepuasanPublik: number;
  jumlahPenilai: number;
  /** persentase isu aktif yang sudah mendapat respons pemerintah */
  tingkatRespons: number;
  diperbarui: string;
}

export interface ProvinsiAgregat {
  id: string;
  nama: string;
  lat: number;
  lng: number;
  jumlahLaporan: number;
  isuAktif: number;
  perKategori: Record<KategoriId, number>;
  perStatus: Record<StatusIsu, number>;
}

export interface TrenBulanan {
  bulan: string; // "2026-04"
  masuk: number;
  terverifikasi: number;
}

export interface HeadlineBerita {
  id: string;
  judul: string;
  sumber: string;
  tanggal: string;
  url: string;
  isuId?: string;
}

export interface ReportTracking {
  reportId: string;
  judul: string;
  kategori: KategoriId;
  subkategori: string;
  dikirim: string;
  status: StatusIsu | "ditolak";
  isuTerkaitId?: string;
  riwayat: { tanggal: string; status: StatusIsu | "ditolak"; keterangan: string }[];
}

export interface IssueFilter {
  q?: string;
  kategori?: KategoriId | "semua";
  status?: StatusIsu | "semua";
  provinsiId?: string | "semua";
  urutkan?: IssueRankingKey;
}

/** Issue ranking (PDF §21) */
export type IssueRankingKey =
  | "terbanyak"
  | "terdesak"
  | "terdampak"
  | "didukung"
  | "kepuasanTerendah"
  | "terlamaBelumSelesai"
  | "terbaru";
