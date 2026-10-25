import type { DemandCategory, DemandScope } from "../../shared/demands.ts"
import type { DemandItemState } from "../../shared/status.ts"

// Sample tuntutan, admin authored

export const SAMPLE_MARK = "[Data sampel]"
export const SAMPLE_BRIEF_URL =
  "https://docs.google.com/document/d/contoh-brief-tuntutan/view"

export type PlannedDemandUpdate = {
  // Index into items
  item: number
  daysAgo: number
  // Absent: dated note only
  to?: DemandItemState
  note: string
  source: string
}

export type PlannedDemand = {
  scope: DemandScope
  provinceCode: string | null
  regencyCode: string | null
  category: DemandCategory
  title: string
  body: string
  summary: string
  target: string
  raisedDaysAgo: number
  // Null stays a draft
  publishDaysAgo: number | null
  items: string[]
  updates: PlannedDemandUpdate[]
  briefs: { item: number; daysAgo: number; summary: string }[]
  // Subcategory prefix of linked issues
  issues: string | null
  close: { daysAgo: number; note: string } | null
  // Example external brief links
  briefLinks?: { demand: boolean; items: number[] }
}

const responded = (
  fulfilment: DemandItemState["fulfilment"],
): DemandItemState => ({ response: "responded", fulfilment })

const ITB: PlannedDemand[] = [
  {
    scope: "national",
    provinceCode: null,
    regencyCode: null,
    category: "bantuan_sosial",
    title: "Buka data penerima bantuan pangan per desa",
    briefLinks: { demand: true, items: [0, 1] },
    body: `${SAMPLE_MARK} Kami menuntut daftar penerima bantuan pangan dibuka per desa dan kelurahan dalam bentuk tersamarkan, beserta jadwal penyaluran setiap bulan, agar warga bisa ikut mengawasi ketepatan sasaran.`,
    summary:
      "Daftar penerima bantuan pangan (tersamarkan) dan jadwal penyaluran dibuka per desa agar warga bisa mengawasi sasaran.",
    target: "Kementerian Sosial",
    raisedDaysAgo: 120,
    publishDaysAgo: 118,
    items: [
      "Daftar penerima bantuan pangan per desa dibuka dalam bentuk tersamarkan",
      "Jadwal penyaluran bulanan diumumkan di kantor desa dan situs resmi",
      "Kanal aduan salah sasaran dibuka dengan nomor tiket",
      "Hasil pemutakhiran data penerima diumumkan setiap tiga bulan",
    ],
    updates: [
      {
        item: 0,
        daysAgo: 90,
        to: { response: "responded", fulfilment: "not_fulfilled" },
        note: `${SAMPLE_MARK} Kementerian menjawab surat audiensi dan menyatakan daftar penerima sedang ditinjau untuk dibuka bertahap.`,
        source: `${SAMPLE_MARK} Surat balasan audiensi nomor 14/2026`,
      },
      {
        item: 1,
        daysAgo: 60,
        to: responded("fulfilled"),
        note: `${SAMPLE_MARK} Jadwal penyaluran bulanan kini ditempel di kantor desa dan diunggah ke situs resmi.`,
        source: `${SAMPLE_MARK} Pengumuman jadwal penyaluran, pemeriksaan lapangan tim`,
      },
      {
        item: 0,
        daysAgo: 30,
        to: responded("partially_fulfilled"),
        note: `${SAMPLE_MARK} Daftar penerima dibuka untuk sebagian kabupaten. Desa lain menyusul tahun depan.`,
        source: `${SAMPLE_MARK} Siaran pers kementerian`,
      },
      {
        item: 2,
        daysAgo: 20,
        note: `${SAMPLE_MARK} Tim mengirim surat susulan berisi contoh aduan salah sasaran dari isu terkait.`,
        source: `${SAMPLE_MARK} Surat susulan tim advokasi`,
      },
    ],
    briefs: [
      {
        item: 0,
        daysAgo: 100,
        summary: `${SAMPLE_MARK} Membuka daftar penerima per desa dalam bentuk tersamarkan mengurangi salah sasaran tanpa membuka data pribadi. Brief ini memuat usulan format dan batas data yang aman dibuka.`,
      },
    ],
    issues: "bansos",
    close: null,
  },
  {
    scope: "regional",
    provinceCode: "32",
    regencyCode: "32.73",
    category: "infrastruktur_transportasi",
    title: "Standar layanan minimum air bersih di Kota Bandung",
    briefLinks: { demand: true, items: [] },
    body: `${SAMPLE_MARK} Kami menuntut standar waktu pemulihan suplai air bersih saat gangguan, kewajiban tangki air bantuan bila gangguan lebih dari 24 jam, dan laporan gangguan yang terbuka untuk warga.`,
    summary:
      "Waktu pemulihan suplai air bersih ditetapkan, tangki air bantuan wajib saat gangguan panjang, dan laporan gangguan dibuka.",
    target: "Pemerintah Kota Bandung",
    raisedDaysAgo: 80,
    publishDaysAgo: 78,
    items: [
      "Standar waktu pemulihan suplai air ditetapkan dalam peraturan wali kota",
      "Tangki air bantuan dikirim bila gangguan lebih dari 24 jam",
      "Peta gangguan suplai air diperbarui setiap hari",
      "Kompensasi tagihan untuk pelanggan yang terdampak gangguan panjang",
      "Forum warga dan perusahaan air minum digelar setiap triwulan",
    ],
    updates: [
      {
        item: 1,
        daysAgo: 50,
        to: responded("fulfilled"),
        note: `${SAMPLE_MARK} Pemerintah kota mewajibkan tangki air bantuan untuk gangguan di atas 24 jam.`,
        source: `${SAMPLE_MARK} Surat edaran wali kota`,
      },
      {
        item: 0,
        daysAgo: 40,
        to: responded("partially_fulfilled"),
        note: `${SAMPLE_MARK} Rancangan peraturan memuat standar waktu pemulihan, tetapi belum ditetapkan.`,
        source: `${SAMPLE_MARK} Rapat dengar pendapat bersama DPRD`,
      },
      {
        item: 3,
        daysAgo: 25,
        to: responded("rejected"),
        note: `${SAMPLE_MARK} Kompensasi tagihan ditolak dengan alasan anggaran perusahaan air minum.`,
        source: `${SAMPLE_MARK} Notulen rapat dengar pendapat`,
      },
      {
        item: 2,
        daysAgo: 10,
        to: responded("fulfilled"),
        note: `${SAMPLE_MARK} Peta gangguan suplai air kini terbit setiap pagi.`,
        source: `${SAMPLE_MARK} Pemeriksaan tim pada situs perusahaan air minum`,
      },
    ],
    briefs: [
      {
        item: 0,
        daysAgo: 60,
        summary: `${SAMPLE_MARK} Kota lain sudah memakai standar pemulihan 24 jam. Brief ini membandingkan tiga standar dan mengusulkan angka yang realistis untuk Bandung.`,
      },
      {
        item: 3,
        daysAgo: 35,
        summary: `${SAMPLE_MARK} Kompensasi tagihan bisa dibiayai dari denda keterlambatan kontraktor. Brief ini menghitung perkiraan biayanya.`,
      },
    ],
    issues: "program.air",
    close: null,
  },
  {
    scope: "regional",
    provinceCode: "32",
    regencyCode: "32.05",
    category: "kebencanaan",
    title: "Percepatan dana stimulan rumah rusak pascagempa di Garut",
    body: `${SAMPLE_MARK} Kami menuntut batas waktu pencairan dana stimulan untuk rumah rusak pascagempa dan publikasi progres verifikasi kerusakan per desa.`,
    summary:
      "Batas waktu pencairan dana stimulan rumah rusak dan publikasi progres verifikasi kerusakan per desa.",
    target: "Pemerintah Kabupaten Garut",
    raisedDaysAgo: 40,
    publishDaysAgo: 38,
    items: [
      "Batas waktu pencairan dana stimulan diumumkan",
      "Progres verifikasi kerusakan dipublikasikan per desa",
      "Posko pengaduan verifikasi dibuka di setiap kecamatan terdampak",
    ],
    updates: [],
    briefs: [],
    issues: "bencana.gempa",
    close: null,
  },
  {
    scope: "national",
    provinceCode: null,
    regencyCode: null,
    category: "kesehatan",
    title: "Posko kesehatan dan masker gratis saat kabut asap",
    body: `${SAMPLE_MARK} Kami menuntut posko kesehatan dan pembagian masker standar di daerah dengan kualitas udara berbahaya selama musim kabut asap.`,
    summary:
      "Posko kesehatan dan masker standar disediakan di daerah dengan kualitas udara berbahaya.",
    target: "Kementerian Kesehatan",
    raisedDaysAgo: 200,
    publishDaysAgo: 198,
    items: [
      "Posko kesehatan dibuka di daerah dengan indeks kualitas udara berbahaya",
      "Masker standar dibagikan gratis kepada kelompok rentan",
      "Data kualitas udara harian diumumkan terbuka",
    ],
    updates: [
      {
        item: 0,
        daysAgo: 170,
        to: responded("fulfilled"),
        note: `${SAMPLE_MARK} Posko kesehatan dibuka di daerah terdampak selama musim kabut asap.`,
        source: `${SAMPLE_MARK} Siaran pers kementerian`,
      },
      {
        item: 1,
        daysAgo: 165,
        to: responded("fulfilled"),
        note: `${SAMPLE_MARK} Masker dibagikan kepada sekolah dan puskesmas di daerah terdampak.`,
        source: `${SAMPLE_MARK} Pemeriksaan lapangan tim`,
      },
      {
        item: 2,
        daysAgo: 160,
        to: responded("fulfilled"),
        note: `${SAMPLE_MARK} Data kualitas udara harian kini terbit di situs resmi.`,
        source: `${SAMPLE_MARK} Pemeriksaan tim pada situs resmi`,
      },
    ],
    briefs: [],
    issues: null,
    close: {
      daysAgo: 150,
      note: `${SAMPLE_MARK} Semua subtuntutan dipenuhi. Pengawalan berlanjut lewat isu baru bila kabut asap kembali.`,
    },
  },
  {
    scope: "regional",
    provinceCode: "32",
    regencyCode: "32.04",
    category: "infrastruktur_transportasi",
    title: "Perbaikan jembatan gantung penghubung sekolah di Kabupaten Bandung",
    body: `${SAMPLE_MARK} Draf: tuntutan perbaikan jembatan gantung yang dipakai siswa menuju sekolah.`,
    summary: "Draf tuntutan perbaikan jembatan gantung menuju sekolah.",
    target: "Pemerintah Kabupaten Bandung",
    raisedDaysAgo: 5,
    publishDaysAgo: null,
    items: [
      "Jembatan gantung diperbaiki sebelum musim hujan",
      "Hasil uji kelayakan jembatan diumumkan kepada warga",
      "Jalur penyeberangan sementara disediakan selama perbaikan",
    ],
    updates: [],
    briefs: [],
    issues: null,
    close: null,
  },
  {
    scope: "regional",
    provinceCode: "31",
    regencyCode: "31.74",
    category: "infrastruktur_transportasi",
    title: "Trotoar dan penyeberangan ramah difabel di sekitar Stasiun Tebet",
    body: `${SAMPLE_MARK} Kami menuntut trotoar tanpa penghalang, ubin pemandu yang tersambung, dan penyeberangan dengan lampu suara di sekitar Stasiun Tebet.`,
    summary:
      "Trotoar tanpa penghalang, ubin pemandu tersambung, dan penyeberangan berlampu suara di sekitar Stasiun Tebet.",
    target: "Pemerintah Provinsi DKI Jakarta",
    raisedDaysAgo: 75,
    publishDaysAgo: 73,
    items: [
      "Penghalang di trotoar sekitar stasiun dibongkar",
      "Ubin pemandu disambung dari pintu stasiun sampai halte",
      "Penyeberangan dilengkapi lampu dan bunyi penanda",
    ],
    updates: [
      {
        item: 0,
        daysAgo: 40,
        to: responded("fulfilled"),
        note: `${SAMPLE_MARK} Pot beton dan tiang yang menghalangi trotoar sudah dipindahkan.`,
        source: `${SAMPLE_MARK} Pemeriksaan lapangan tim`,
      },
      {
        item: 2,
        daysAgo: 25,
        to: { response: "responded", fulfilment: "not_fulfilled" },
        note: `${SAMPLE_MARK} Dinas menjawab penyeberangan berlampu suara masuk rencana anggaran tahun depan.`,
        source: `${SAMPLE_MARK} Surat balasan dinas perhubungan`,
      },
    ],
    briefs: [],
    issues: null,
    close: null,
  },
  {
    scope: "regional",
    provinceCode: "32",
    regencyCode: "32.01",
    category: "lingkungan_hidup",
    title: "Jadwal angkut sampah yang tetap di permukiman Kabupaten Bogor",
    body: `${SAMPLE_MARK} Kami menuntut jadwal angkut sampah yang tetap dan diumumkan, tempat penampungan sementara yang tertutup, dan kanal aduan bila jadwal terlewat.`,
    summary:
      "Jadwal angkut sampah tetap dan diumumkan, penampungan sementara tertutup, dan kanal aduan bila jadwal terlewat.",
    target: "Pemerintah Kabupaten Bogor",
    raisedDaysAgo: 45,
    publishDaysAgo: 43,
    items: [
      "Jadwal angkut sampah per kelurahan diumumkan",
      "Tempat penampungan sementara diberi penutup",
      "Kanal aduan jadwal terlewat dibuka dengan nomor tiket",
    ],
    updates: [
      {
        item: 0,
        daysAgo: 15,
        note: `${SAMPLE_MARK} Tim mengirim daftar titik penumpukan sampah dari laporan warga kepada dinas.`,
        source: `${SAMPLE_MARK} Surat tim advokasi`,
      },
    ],
    briefs: [],
    issues: null,
    close: null,
  },
]

const UGM: PlannedDemand[] = [
  {
    scope: "regional",
    provinceCode: "34",
    regencyCode: "34.03",
    category: "kebencanaan",
    title: "Air bersih saat kemarau di Gunungkidul",
    briefLinks: { demand: true, items: [2] },
    body: `${SAMPLE_MARK} Kami menuntut jadwal distribusi air bersih yang pasti selama kemarau, prioritas dusun tanpa sumber air, dan rencana jaringan pipa jangka panjang.`,
    summary:
      "Jadwal distribusi air bersih yang pasti selama kemarau dan rencana jaringan pipa untuk dusun tanpa sumber air.",
    target: "Pemerintah Kabupaten Gunungkidul",
    raisedDaysAgo: 90,
    publishDaysAgo: 88,
    items: [
      "Jadwal distribusi air bersih diumumkan per dusun",
      "Dusun tanpa sumber air didahulukan dalam distribusi",
      "Rencana jaringan pipa jangka panjang dimasukkan ke anggaran daerah",
      "Kualitas air distribusi diuji dan hasilnya diumumkan",
    ],
    updates: [
      {
        item: 0,
        daysAgo: 70,
        to: responded("fulfilled"),
        note: `${SAMPLE_MARK} Jadwal distribusi kini diumumkan di balai dusun setiap pekan.`,
        source: `${SAMPLE_MARK} Pemeriksaan lapangan tim`,
      },
      {
        item: 1,
        daysAgo: 55,
        to: responded("partially_fulfilled"),
        note: `${SAMPLE_MARK} Sebagian dusun tanpa sumber air sudah didahulukan, sebagian lain belum.`,
        source: `${SAMPLE_MARK} Surat balasan dinas`,
      },
      {
        item: 2,
        daysAgo: 30,
        to: responded("rejected"),
        note: `${SAMPLE_MARK} Rencana jaringan pipa belum masuk anggaran tahun ini.`,
        source: `${SAMPLE_MARK} Rapat dengar pendapat bersama DPRD`,
      },
    ],
    briefs: [
      {
        item: 2,
        daysAgo: 45,
        summary: `${SAMPLE_MARK} Biaya distribusi tangki tiap kemarau mendekati biaya jaringan pipa dalam lima tahun. Brief ini memuat perbandingannya.`,
      },
    ],
    issues: "bencana.kekeringan",
    close: null,
  },
  {
    scope: "regional",
    provinceCode: "34",
    regencyCode: "34.02",
    category: "kebencanaan",
    title: "Perbaikan tanggul sungai sebelum musim hujan di Bantul",
    body: `${SAMPLE_MARK} Kami menuntut perbaikan tanggul sungai yang jebol tahun lalu sebelum musim hujan dan jalur evakuasi yang ditandai jelas.`,
    summary:
      "Tanggul sungai yang jebol diperbaiki sebelum musim hujan dan jalur evakuasi ditandai.",
    target: "Pemerintah Kabupaten Bantul",
    raisedDaysAgo: 50,
    publishDaysAgo: 48,
    items: [
      "Tanggul yang jebol diperbaiki sebelum musim hujan",
      "Jalur evakuasi banjir ditandai dan disosialisasikan",
      "Peringatan dini banjir dikirim lewat pengeras suara masjid dan pesan singkat",
    ],
    updates: [
      {
        item: 1,
        daysAgo: 20,
        note: `${SAMPLE_MARK} Tim mengirim peta titik rawan dari isu terkait kepada BPBD.`,
        source: `${SAMPLE_MARK} Surat tim advokasi`,
      },
    ],
    briefs: [],
    issues: "bencana.banjir",
    close: null,
  },
  {
    scope: "national",
    provinceCode: null,
    regencyCode: null,
    category: "pendidikan",
    title: "Transparansi kuota dan kriteria bantuan biaya kuliah",
    body: `${SAMPLE_MARK} Kami menuntut kuota bantuan biaya kuliah per kampus diumumkan sebelum pendaftaran dan kriteria seleksinya dibuka.`,
    summary:
      "Kuota bantuan biaya kuliah per kampus diumumkan sebelum pendaftaran dan kriteria seleksinya dibuka.",
    target: "Kementerian Pendidikan Tinggi, Sains, dan Teknologi",
    raisedDaysAgo: 60,
    publishDaysAgo: 58,
    items: [
      "Kuota per kampus diumumkan sebelum pendaftaran dibuka",
      "Kriteria seleksi dan bobotnya dipublikasikan",
      "Jalur sanggah bagi pendaftar yang ditolak dibuka",
    ],
    updates: [
      {
        item: 0,
        daysAgo: 35,
        to: { response: "responded", fulfilment: "not_fulfilled" },
        note: `${SAMPLE_MARK} Kementerian menyatakan kuota akan diumumkan bersamaan dengan pengumuman hasil.`,
        source: `${SAMPLE_MARK} Jawaban tertulis kementerian`,
      },
    ],
    briefs: [
      {
        item: 1,
        daysAgo: 40,
        summary: `${SAMPLE_MARK} Kriteria yang terbuka mengurangi sanggah dan memudahkan pendaftar menyiapkan berkas. Brief ini memuat contoh kriteria dan bobot.`,
      },
    ],
    issues: null,
    close: null,
  },
  {
    scope: "regional",
    provinceCode: "33",
    regencyCode: "33.74",
    category: "lingkungan_hidup",
    title: "Penanganan banjir rob di pesisir Kota Semarang",
    body: `${SAMPLE_MARK} Kami menuntut pompa air tambahan di kawasan pesisir, perbaikan tanggul laut, dan bantuan perbaikan rumah warga yang terdampak rob berulang.`,
    summary:
      "Pompa tambahan, perbaikan tanggul laut, dan bantuan perbaikan rumah untuk warga pesisir yang terdampak rob.",
    target: "Pemerintah Kota Semarang",
    raisedDaysAgo: 30,
    publishDaysAgo: 28,
    items: [
      "Pompa air tambahan dipasang di kawasan pesisir",
      "Tanggul laut yang retak diperbaiki",
      "Bantuan perbaikan rumah untuk warga terdampak rob berulang",
    ],
    updates: [
      {
        item: 0,
        daysAgo: 12,
        to: responded("partially_fulfilled"),
        note: `${SAMPLE_MARK} Dua pompa tambahan dipasang, empat lainnya masih dalam pengadaan.`,
        source: `${SAMPLE_MARK} Pemeriksaan lapangan tim`,
      },
    ],
    briefs: [],
    issues: "bencana.bencana_pesisir",
    close: null,
  },
  {
    scope: "regional",
    provinceCode: "35",
    regencyCode: null,
    category: "kebencanaan",
    title: "Pasokan air bersih saat kemarau panjang di Jawa Timur",
    body: `${SAMPLE_MARK} Kami menuntut jadwal distribusi air bersih yang diumumkan untuk desa terdampak kemarau dan data desa rawan kekeringan yang diperbarui setiap musim.`,
    summary:
      "Jadwal distribusi air bersih untuk desa terdampak kemarau diumumkan dan data desa rawan kekeringan diperbarui.",
    target: "Pemerintah Provinsi Jawa Timur",
    raisedDaysAgo: 40,
    publishDaysAgo: 38,
    items: [
      "Jadwal distribusi air bersih per desa diumumkan",
      "Data desa rawan kekeringan diperbarui setiap musim",
      "Sumur bor darurat dibangun di desa yang paling terdampak",
    ],
    updates: [
      {
        item: 0,
        daysAgo: 18,
        to: responded("fulfilled"),
        note: `${SAMPLE_MARK} Jadwal distribusi air bersih kini diumumkan setiap pekan di situs pemerintah provinsi.`,
        source: `${SAMPLE_MARK} Pengumuman pemerintah provinsi`,
      },
    ],
    briefs: [],
    issues: null,
    close: null,
  },
]

export const SAMPLE_DEMANDS: Record<"itb" | "ugm", PlannedDemand[]> = {
  itb: ITB,
  ugm: UGM,
}
