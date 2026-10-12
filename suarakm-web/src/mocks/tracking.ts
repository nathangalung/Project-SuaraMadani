import type { ReportTracking } from "@/types/domain";

/** DATA CONTOH — coba lacak dengan ID KM-2026-0412 atau KM-2026-0388 */
export const TRACKING: ReportTracking[] = [
  {
    reportId: "KM-2026-0412",
    judul: "Keran air mati sejak tanggal 3 di RW 07",
    kategori: "program",
    subkategori: "Air bersih",
    dikirim: "2026-08-19T07:40:00+07:00",
    status: "direspons",
    isuTerkaitId: "ISU-0142",
    riwayat: [
      { tanggal: "2026-08-19T07:40:00+07:00", status: "dilaporkan", keterangan: "Laporan diterima sistem." },
      { tanggal: "2026-08-21T10:00:00+07:00", status: "terverifikasi", keterangan: "Laporan diverifikasi dan digabung ke isu ISU-0142." },
      { tanggal: "2026-09-02T09:00:00+07:00", status: "diproses", keterangan: "Isu diteruskan ke instansi terkait." },
      { tanggal: "2026-10-06T14:30:00+07:00", status: "direspons", keterangan: "Instansi memberi tanggapan resmi. Beri penilaianmu di halaman isu." },
    ],
  },
  {
    reportId: "KM-2026-0388",
    judul: "Beras bantuan belum datang tiga bulan",
    kategori: "bansos",
    subkategori: "Keterlambatan bantuan",
    dikirim: "2026-08-02T16:05:00+07:00",
    status: "diproses",
    isuTerkaitId: "ISU-0137",
    riwayat: [
      { tanggal: "2026-08-02T16:05:00+07:00", status: "dilaporkan", keterangan: "Laporan diterima sistem." },
      { tanggal: "2026-08-05T13:00:00+07:00", status: "terverifikasi", keterangan: "Laporan diverifikasi dan digabung ke isu ISU-0137." },
      { tanggal: "2026-10-02T09:15:00+07:00", status: "diproses", keterangan: "Isu masuk kajian advokasi." },
    ],
  },
];
