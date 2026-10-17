import type { SubcategoryId } from "../../shared/categories.ts"
import type { ComplaintPart, ComplaintReason } from "../../shared/complaints.ts"
import type {
  RejectReason,
  UnverifiableReason,
} from "../../shared/moderation.ts"
import type { IssueAction } from "../../shared/status.ts"

// Codes and names: cahyadsn/wilayah, MIT
export const SAMPLE_REGIONS: ReadonlyArray<
  readonly [string, string | null, string]
> = [
  ["12", null, "Sumatera Utara"],
  ["12.71", "12", "Kota Medan"],
  ["12.71.02", "12.71", "Medan Sunggal"],
  ["12.71.04", "12.71", "Medan Denai"],
  ["31", null, "Daerah Khusus Ibukota Jakarta"],
  ["31.74", "31", "Kota Administrasi Jakarta Selatan"],
  ["31.74.01", "31.74", "Tebet"],
  ["31.74.04", "31.74", "Pasar Minggu"],
  ["31.75", "31", "Kota Administrasi Jakarta Timur"],
  ["31.75.03", "31.75", "Jatinegara"],
  ["31.75.04", "31.75", "Kramatjati"],
  ["32.01", "32", "Kabupaten Bogor"],
  ["32.01.01", "32.01", "Cibinong"],
  ["32.01.03", "32.01", "Citeureup"],
  ["32.03", "32", "Kabupaten Cianjur"],
  ["32.03.01", "32.03", "Cianjur"],
  ["32.03.04", "32.03", "Cilaku"],
  ["32.04", "32", "Kabupaten Bandung"],
  ["32.04.05", "32.04", "Cileunyi"],
  ["32.04.08", "32.04", "Bojongsoang"],
  ["32.05", "32", "Kabupaten Garut"],
  ["32.05.01", "32.05", "Garut Kota"],
  ["32.05.04", "32.05", "Tarogong Kaler"],
  ["33", null, "Jawa Tengah"],
  ["33.02", "33", "Kabupaten Banyumas"],
  ["33.02.02", "33.02", "Wangon"],
  ["33.02.04", "33.02", "Rawalo"],
  ["33.74", "33", "Kota Semarang"],
  ["33.74.02", "33.74", "Semarang Utara"],
  ["33.74.04", "33.74", "Gayamsari"],
  ["34.02", "34", "Kabupaten Bantul"],
  ["34.02.03", "34.02", "Kretek"],
  ["34.02.04", "34.02", "Pundong"],
  ["34.03", "34", "Kabupaten Gunungkidul"],
  ["34.03.01", "34.03", "Wonosari"],
  ["34.03.03", "34.03", "Playen"],
  ["35", null, "Jawa Timur"],
  ["35.07", "35", "Kabupaten Malang"],
  ["35.07.03", "35.07", "Bantur"],
  ["35.07.04", "35.07", "Sumbermanjing Wetan"],
  ["35.78", "35", "Kota Surabaya"],
  ["35.78.03", "35.78", "Rungkut"],
  ["35.78.04", "35.78", "Wonokromo"],
  ["36", null, "Banten"],
  ["36.02", "36", "Kabupaten Lebak"],
  ["36.02.01", "36.02", "Malingping"],
  ["36.02.03", "36.02", "Bayah"],
  ["36.03", "36", "Kabupaten Tangerang"],
  ["36.03.01", "36.03", "Balaraja"],
  ["36.03.03", "36.03", "Tigaraksa"],
  ["51", null, "Bali"],
  ["51.71", "51", "Kota Denpasar"],
  ["51.71.01", "51.71", "Denpasar Selatan"],
  ["51.71.04", "51.71", "Denpasar Utara"],
  ["53", null, "Nusa Tenggara Timur"],
  ["53.02", "53", "Kabupaten Timor Tengah Selatan"],
  ["53.02.01", "53.02", "Kota Soe"],
  ["53.02.03", "53.02", "Mollo Utara"],
  ["53.71", "53", "Kota Kupang"],
  ["53.71.01", "53.71", "Alak"],
  ["53.71.02", "53.71", "Maulafa"],
  ["64", null, "Kalimantan Timur"],
  ["64.71", "64", "Kota Balikpapan"],
  ["64.71.01", "64.71", "Balikpapan Timur"],
  ["64.71.03", "64.71", "Balikpapan Utara"],
  ["73", null, "Sulawesi Selatan"],
  ["73.71", "73", "Kota Makassar"],
  ["73.71.01", "73.71", "Mariso"],
  ["73.71.02", "73.71", "Mamajang"],
]

export type SamplePlace = {
  regency: string
  // Short name for story text
  label: string
  // Agency area, Jakarta is provincial
  area: string
  districts: readonly (readonly [string, string])[]
  weight: number
}

const place = (
  regency: string,
  label: string,
  districts: SamplePlace["districts"],
  weight: number,
  area = label,
): SamplePlace => ({ regency, label, area, districts, weight })

export const PLACES = {
  bandung: place(
    "32.73",
    "Kota Bandung",
    [
      ["32.73.01", "Sukasari"],
      ["32.73.02", "Coblong"],
    ],
    16,
  ),
  kabBandung: place(
    "32.04",
    "Kabupaten Bandung",
    [
      ["32.04.05", "Cileunyi"],
      ["32.04.08", "Bojongsoang"],
    ],
    12,
  ),
  garut: place(
    "32.05",
    "Kabupaten Garut",
    [
      ["32.05.01", "Garut Kota"],
      ["32.05.04", "Tarogong Kaler"],
    ],
    8,
  ),
  cianjur: place(
    "32.03",
    "Kabupaten Cianjur",
    [
      ["32.03.01", "Cianjur"],
      ["32.03.04", "Cilaku"],
    ],
    5,
  ),
  bogor: place(
    "32.01",
    "Kabupaten Bogor",
    [
      ["32.01.01", "Cibinong"],
      ["32.01.03", "Citeureup"],
    ],
    5,
  ),
  jakselatan: place(
    "31.74",
    "Jakarta Selatan",
    [
      ["31.74.01", "Tebet"],
      ["31.74.04", "Pasar Minggu"],
    ],
    6,
    "Provinsi DKI Jakarta",
  ),
  jaktimur: place(
    "31.75",
    "Jakarta Timur",
    [
      ["31.75.03", "Jatinegara"],
      ["31.75.04", "Kramatjati"],
    ],
    6,
    "Provinsi DKI Jakarta",
  ),
  semarang: place(
    "33.74",
    "Kota Semarang",
    [
      ["33.74.02", "Semarang Utara"],
      ["33.74.04", "Gayamsari"],
    ],
    5,
  ),
  banyumas: place(
    "33.02",
    "Kabupaten Banyumas",
    [
      ["33.02.02", "Wangon"],
      ["33.02.04", "Rawalo"],
    ],
    4,
  ),
  surabaya: place(
    "35.78",
    "Kota Surabaya",
    [
      ["35.78.03", "Rungkut"],
      ["35.78.04", "Wonokromo"],
    ],
    4,
  ),
  malang: place(
    "35.07",
    "Kabupaten Malang",
    [
      ["35.07.03", "Bantur"],
      ["35.07.04", "Sumbermanjing Wetan"],
    ],
    4,
  ),
  tangerang: place(
    "36.03",
    "Kabupaten Tangerang",
    [
      ["36.03.01", "Balaraja"],
      ["36.03.03", "Tigaraksa"],
    ],
    4,
  ),
  lebak: place(
    "36.02",
    "Kabupaten Lebak",
    [
      ["36.02.01", "Malingping"],
      ["36.02.03", "Bayah"],
    ],
    3,
  ),
  sleman: place(
    "34.04",
    "Kabupaten Sleman",
    [
      ["34.04.06", "Mlati"],
      ["34.04.07", "Depok"],
    ],
    4,
  ),
  jogja: place("34.71", "Kota Yogyakarta", [["34.71.03", "Gondokusuman"]], 3),
  bantul: place(
    "34.02",
    "Kabupaten Bantul",
    [
      ["34.02.03", "Kretek"],
      ["34.02.04", "Pundong"],
    ],
    3,
  ),
  gunungkidul: place(
    "34.03",
    "Kabupaten Gunungkidul",
    [
      ["34.03.01", "Wonosari"],
      ["34.03.03", "Playen"],
    ],
    3,
  ),
  medan: place(
    "12.71",
    "Kota Medan",
    [
      ["12.71.02", "Medan Sunggal"],
      ["12.71.04", "Medan Denai"],
    ],
    4,
  ),
  makassar: place(
    "73.71",
    "Kota Makassar",
    [
      ["73.71.01", "Mariso"],
      ["73.71.02", "Mamajang"],
    ],
    3,
  ),
  kupang: place(
    "53.71",
    "Kota Kupang",
    [
      ["53.71.01", "Alak"],
      ["53.71.02", "Maulafa"],
    ],
    2,
  ),
  soe: place(
    "53.02",
    "Kabupaten Timor Tengah Selatan",
    [
      ["53.02.01", "Kota Soe"],
      ["53.02.03", "Mollo Utara"],
    ],
    1,
  ),
  balikpapan: place(
    "64.71",
    "Kota Balikpapan",
    [
      ["64.71.01", "Balikpapan Timur"],
      ["64.71.03", "Balikpapan Utara"],
    ],
    2,
  ),
  denpasar: place(
    "51.71",
    "Kota Denpasar",
    [
      ["51.71.01", "Denpasar Selatan"],
      ["51.71.04", "Denpasar Utara"],
    ],
    1,
  ),
} as const

export type PlaceKey = keyof typeof PLACES

type Text = { title: string; story: string }

export type SampleTheme = {
  subcategory: SubcategoryId
  issue: { title: string; summary: string }
  reports: readonly Text[]
  // Forwarding target role, never quoted
  agency: string
  // Undefined fits every place
  places?: readonly PlaceKey[]
}

const FLOOD: readonly PlaceKey[] = [
  "kabBandung",
  "jaktimur",
  "semarang",
  "medan",
  "tangerang",
  "makassar",
  "bantul",
]
const SLOPE: readonly PlaceKey[] = [
  "garut",
  "cianjur",
  "bogor",
  "banyumas",
  "malang",
  "soe",
  "kabBandung",
]
const DRY: readonly PlaceKey[] = [
  "soe",
  "kupang",
  "gunungkidul",
  "lebak",
  "malang",
]
const COAST: readonly PlaceKey[] = ["semarang", "lebak", "bantul", "makassar"]

// {kec} district, {kab} regency label
export const THEMES: readonly SampleTheme[] = [
  {
    subcategory: "program.pendidikan",
    issue: {
      title: "Ruang kelas SD rusak di {kec}, siswa belajar bergantian",
      summary:
        "Atap dua ruang kelas di sebuah SD negeri di {kec} ambruk sebagian. Siswa kelas 3 dan 4 belajar bergantian di satu ruangan sejak awal semester.",
    },
    reports: [
      {
        title: "Atap kelas SD di {kec} ambruk sebagian",
        story:
          "Atap ruang kelas 4 di SD negeri dekat rumah kami ambruk sebagian setelah hujan deras. Sekarang siswa belajar bergantian di ruang guru.",
      },
      {
        title: "Anak kami belajar di ruang guru karena kelas rusak",
        story:
          "Sudah dua bulan anak kami belajar di ruang guru. Plafon kelas jebol dan sekolah belum mendapat jadwal perbaikan dari dinas.",
      },
      {
        title: "Sekolah di {kec} belum diperbaiki setelah plafon jebol",
        story:
          "Plafon dua kelas jebol sejak awal semester. Kursi dan meja dipindah ke lorong. Orang tua khawatir bagian atap lain ikut runtuh.",
      },
    ],
    agency: "Dinas Pendidikan {area}",
  },
  {
    subcategory: "program.kesehatan",
    issue: {
      title: "Puskesmas di {kec} kekurangan obat dasar",
      summary:
        "Pasien di puskesmas {kec} diminta membeli sendiri obat penurun panas dan antibiotik di apotek. Stok obat dasar kosong lebih dari tiga minggu.",
    },
    reports: [
      {
        title: "Obat di puskesmas {kec} kosong tiga minggu",
        story:
          "Saat berobat, petugas bilang stok parasetamol dan amoksisilin kosong. Kami diminta membeli sendiri di apotek dengan resep dari puskesmas.",
      },
      {
        title: "Pasien diminta beli obat sendiri di luar puskesmas",
        story:
          "Ibu saya peserta jaminan kesehatan, tetapi harus membeli obat hipertensi sendiri karena stok puskesmas habis sejak bulan lalu.",
      },
    ],
    agency: "Dinas Kesehatan {area}",
  },
  {
    subcategory: "program.administrasi_publik",
    issue: {
      title: "Pencetakan KTP-el di {kab} tertunda karena blangko habis",
      summary:
        "Warga yang sudah merekam data menunggu lebih dari dua bulan untuk KTP-el. Kantor dukcapil hanya memberi surat keterangan pengganti.",
    },
    reports: [
      {
        title: "KTP-el belum dicetak dua bulan setelah rekam data",
        story:
          "Saya merekam data KTP-el dua bulan lalu. Setiap kali datang, petugas bilang blangko habis dan hanya memberi surat keterangan.",
      },
      {
        title: "Surat keterangan pengganti KTP ditolak saat melamar kerja",
        story:
          "KTP-el saya belum jadi karena blangko kosong. Surat keterangan dari dukcapil tidak diterima saat saya mendaftar kerja di pabrik.",
      },
      {
        title: "Antrean dukcapil di {kab} penuh sejak subuh",
        story:
          "Warga antre sejak subuh untuk menanyakan KTP-el yang belum jadi. Nomor antrean habis sebelum jam sembilan pagi.",
      },
    ],
    agency: "Dinas Kependudukan dan Pencatatan Sipil {area}",
  },
  {
    subcategory: "program.perumahan",
    issue: {
      title:
        "Perbaikan rumah tidak layak huni di {kec} berhenti di tengah jalan",
      summary:
        "Sejumlah rumah penerima program perbaikan rumah tidak layak huni di {kec} dibiarkan tanpa atap setelah pekerjaan berhenti.",
    },
    reports: [
      {
        title: "Rumah kami dibongkar untuk perbaikan, lalu ditinggal",
        story:
          "Rumah kami masuk program perbaikan rumah tidak layak huni. Atap lama sudah dibongkar, tetapi pekerja tidak datang lagi sejak sebulan lalu.",
      },
      {
        title: "Material bantuan bedah rumah tidak lengkap",
        story:
          "Material yang datang hanya semen dan pasir. Kayu dan genteng yang dijanjikan belum dikirim, padahal musim hujan sudah mulai.",
      },
    ],
    agency: "Dinas Perumahan dan Kawasan Permukiman {area}",
  },
  {
    subcategory: "program.pelayanan_pemerintah",
    issue: {
      title: "Kantor kelurahan di {kec} sering tutup di jam layanan",
      summary:
        "Warga melaporkan kantor kelurahan di {kec} tutup sebelum pukul dua siang pada hari kerja. Pengurusan surat pengantar tertunda berhari-hari.",
    },
    reports: [
      {
        title: "Kantor kelurahan sudah tutup pukul satu siang",
        story:
          "Saya datang pukul satu siang untuk surat pengantar, tetapi kantor kelurahan sudah tutup. Papan jam layanan menulis buka sampai pukul empat.",
      },
      {
        title: "Surat pengantar butuh tiga kali datang",
        story:
          "Petugas yang berwenang menandatangani tidak ada di kantor. Kami harus datang tiga kali untuk satu surat pengantar nikah.",
      },
    ],
    agency: "Inspektorat {area}",
  },
  {
    subcategory: "program.transportasi",
    issue: {
      title: "Angkutan umum rute sekolah di {kec} berhenti beroperasi",
      summary:
        "Trayek angkutan umum yang melintasi beberapa sekolah di {kec} berhenti sejak awal bulan. Siswa berjalan kaki lebih dari tiga kilometer.",
    },
    reports: [
      {
        title: "Angkot ke sekolah di {kec} tidak lewat lagi",
        story:
          "Angkutan umum yang biasa lewat depan rumah kami berhenti beroperasi. Anak-anak sekarang berjalan kaki tiga kilometer ke sekolah.",
      },
      {
        title: "Siswa terlambat karena trayek angkutan dihapus",
        story:
          "Sejak trayek dihapus, banyak siswa terlambat masuk sekolah. Ojek terlalu mahal untuk dipakai setiap hari oleh keluarga kami.",
      },
    ],
    agency: "Dinas Perhubungan {area}",
  },
  {
    subcategory: "program.infrastruktur",
    issue: {
      title: "Jalan berlubang di {kec} membahayakan pengendara",
      summary:
        "Ruas jalan sepanjang kurang lebih dua kilometer di {kec} berlubang dalam dan tergenang saat hujan. Warga mencatat beberapa pengendara motor jatuh.",
    },
    reports: [
      {
        title: "Jalan utama {kec} berlubang dalam",
        story:
          "Lubang di jalan utama makin lebar setelah musim hujan. Saat tergenang, lubang tidak terlihat dan pengendara motor sering jatuh.",
      },
      {
        title: "Ambulans sulit lewat jalan rusak ke puskesmas",
        story:
          "Jalan menuju puskesmas rusak berat. Ambulans harus berjalan pelan dan butuh waktu dua kali lipat untuk sampai ke rumah pasien.",
      },
      {
        title: "Warga menimbun lubang jalan sendiri dengan puing",
        story:
          "Karena belum ada perbaikan, warga menimbun lubang dengan puing bangunan. Timbunan itu hanyut lagi setiap kali hujan deras.",
      },
    ],
    agency: "Dinas Pekerjaan Umum dan Penataan Ruang {area}",
  },
  {
    subcategory: "program.air_bersih",
    issue: {
      title: "Air PDAM di {kec} tidak mengalir lebih dari seminggu",
      summary:
        "Distribusi air di beberapa RW di {kec} terhenti. Tangki air bantuan datang tidak menentu dan tidak menjangkau gang sempit.",
    },
    reports: [
      {
        title: "Keran air kering sejak minggu lalu",
        story:
          "Air dari PDAM tidak mengalir ke rumah kami sejak minggu lalu. Kami membeli air galon untuk masak dan mandi.",
      },
      {
        title: "Tangki air bantuan tidak masuk gang kami",
        story:
          "Tangki air hanya berhenti di jalan besar. Warga lansia di gang kami kesulitan mengangkut air sejauh dua ratus meter.",
      },
      {
        title: "Tagihan PDAM tetap datang saat air mati",
        story:
          "Air mati hampir dua minggu, tetapi tagihan bulan ini tidak berkurang. Kami belum mendapat penjelasan soal jadwal perbaikan.",
      },
    ],
    agency: "Perumda Air Minum {area}",
  },
  {
    subcategory: "program.sanitasi",
    issue: {
      title: "Saluran drainase tersumbat di {kec}, limbah menggenang",
      summary:
        "Saluran drainase di permukiman padat {kec} tersumbat sampah. Air limbah rumah tangga menggenang di jalan dan menimbulkan bau.",
    },
    reports: [
      {
        title: "Got tersumbat, air limbah meluap ke jalan",
        story:
          "Saluran di depan rumah kami tersumbat sampah. Air limbah meluap ke jalan setiap pagi dan baunya masuk ke rumah.",
      },
      {
        title: "Genangan limbah di {kec} jadi sarang nyamuk",
        story:
          "Genangan limbah sudah tiga minggu tidak surut. Beberapa anak di RT kami sakit demam berdarah bulan ini.",
      },
    ],
    agency: "Dinas Lingkungan Hidup {area}",
  },
  {
    subcategory: "program.energi",
    issue: {
      title: "Pemadaman listrik berulang tanpa jadwal di {kec}",
      summary:
        "Warga {kec} mengalami pemadaman listrik hampir setiap malam selama dua minggu. Tidak ada pengumuman jadwal pemadaman.",
    },
    reports: [
      {
        title: "Listrik padam hampir setiap malam",
        story:
          "Listrik di rumah kami padam hampir setiap malam selama dua minggu. Anak-anak belajar dengan lampu senter.",
      },
      {
        title: "Usaha warung rugi karena listrik sering padam",
        story:
          "Es dan bahan makanan di warung kami rusak karena listrik padam berjam-jam. Tidak ada pemberitahuan sebelumnya.",
      },
    ],
    agency: "PLN Unit Layanan Pelanggan {area}",
  },
  {
    subcategory: "program.harga_daya_beli",
    issue: {
      title: "Harga beras medium di pasar {kec} melonjak",
      summary:
        "Pedagang dan pembeli di pasar {kec} melaporkan harga beras medium naik jauh di atas harga eceran tertinggi dalam sebulan.",
    },
    reports: [
      {
        title: "Harga beras di pasar naik dua kali dalam sebulan",
        story:
          "Harga beras medium di pasar dekat rumah naik dua kali bulan ini. Kami mengurangi jatah makan agar uang cukup.",
      },
      {
        title: "Beras medium dijual di atas harga eceran tertinggi",
        story:
          "Pedagang menjual beras medium di atas harga eceran tertinggi. Mereka bilang harga dari penggilingan juga sudah naik.",
      },
    ],
    agency: "Dinas Perdagangan {area}",
  },
  {
    subcategory: "program.pangan",
    issue: {
      title: "Beras program stabilisasi harga sulit didapat di {kab}",
      summary:
        "Warga di {kab} tidak menemukan beras program stabilisasi harga di pasar dan toko pengecer yang terdaftar.",
    },
    reports: [
      {
        title: "Beras stabilisasi harga tidak ada di toko terdaftar",
        story:
          "Kami datang ke tiga toko yang terdaftar sebagai pengecer, tetapi beras program stabilisasi harga selalu kosong.",
      },
      {
        title: "Stok beras murah habis sebelum warga datang",
        story:
          "Stok beras murah di pasar habis dalam satu jam. Warga yang bekerja pagi tidak pernah kebagian.",
      },
    ],
    agency: "Dinas Ketahanan Pangan {area}",
  },
  {
    subcategory: "program.pekerjaan",
    issue: {
      title: "Upah pekerja padat karya di {kec} belum dibayar",
      summary:
        "Pekerja proyek padat karya perbaikan saluran di {kec} belum menerima upah dua minggu kerja.",
    },
    reports: [
      {
        title: "Upah padat karya belum cair dua minggu",
        story:
          "Saya bekerja di proyek padat karya perbaikan saluran selama dua minggu. Upah yang dijanjikan belum dibayar sampai sekarang.",
      },
      {
        title: "Pekerja proyek saluran belum terima upah",
        story:
          "Sekitar tiga puluh pekerja di desa kami belum menerima upah. Pengawas proyek hanya bilang menunggu pencairan.",
      },
    ],
    agency: "Dinas Tenaga Kerja {area}",
  },
  {
    subcategory: "program.kebijakan_publik",
    issue: {
      title: "Retribusi pasar {kec} naik tanpa sosialisasi",
      summary:
        "Pedagang pasar di {kec} menerima tarif retribusi baru yang hampir dua kali lipat tanpa sosialisasi sebelumnya.",
    },
    reports: [
      {
        title: "Retribusi lapak pasar naik hampir dua kali lipat",
        story:
          "Petugas menagih retribusi lapak dengan tarif baru minggu ini. Kami tidak pernah diundang sosialisasi soal kenaikan ini.",
      },
      {
        title: "Pedagang kecil keberatan tarif retribusi baru",
        story:
          "Tarif retribusi baru berlaku sama untuk lapak besar dan kecil. Pedagang sayur seperti saya sulit membayarnya.",
      },
    ],
    agency: "DPRD {area}",
  },
  {
    subcategory: "program.program_pemerintah",
    issue: {
      title: "Makanan tambahan balita di posyandu {kec} terhenti",
      summary:
        "Posyandu di beberapa RW di {kec} tidak lagi membagikan makanan tambahan untuk balita gizi kurang sejak tiga bulan terakhir.",
    },
    reports: [
      {
        title: "Posyandu tidak lagi membagikan makanan tambahan",
        story:
          "Anak saya tercatat gizi kurang. Sejak tiga bulan lalu posyandu tidak lagi membagikan makanan tambahan.",
      },
      {
        title: "Kader posyandu belum menerima paket makanan tambahan",
        story:
          "Kader posyandu bilang paket makanan tambahan belum dikirim dari puskesmas. Balita di RW kami tetap ditimbang setiap bulan.",
      },
    ],
    agency: "Dinas Kesehatan {area}",
  },
  {
    subcategory: "bencana.banjir",
    issue: {
      title: "Banjir berulang di {kec}, ratusan rumah tergenang",
      summary:
        "Banjir setinggi lutut sampai pinggang merendam permukiman di {kec} beberapa kali dalam sebulan. Warga meminta normalisasi sungai dan pompa air.",
    },
    reports: [
      {
        title: "Rumah kami terendam banjir setinggi pinggang",
        story:
          "Banjir merendam rumah kami setinggi pinggang sejak dini hari. Barang elektronik rusak dan anak-anak diungsikan ke rumah kerabat.",
      },
      {
        title: "Banjir di {kec} belum surut dua hari",
        story:
          "Air belum surut dua hari. Jalan utama tertutup dan warga yang sakit sulit dibawa ke puskesmas.",
      },
      {
        title: "Pompa air di {kec} tidak berfungsi saat banjir",
        story:
          "Pompa air di dekat pintu air tidak menyala saat hujan deras. Air dari sungai masuk ke permukiman lebih cepat dari biasanya.",
      },
    ],
    agency: "Badan Penanggulangan Bencana Daerah {area}",
    places: FLOOD,
  },
  {
    subcategory: "bencana.longsor",
    issue: {
      title: "Tebing longsor menutup akses jalan desa di {kec}",
      summary:
        "Longsoran tebing menutup jalan desa di {kec}. Warga membuka jalur darurat sendiri dan meminta penanganan tebing sebelum hujan berikutnya.",
    },
    reports: [
      {
        title: "Longsor menutup jalan ke desa kami",
        story:
          "Tebing di tepi jalan longsor setelah hujan semalaman. Kendaraan tidak bisa lewat dan anak sekolah harus memutar lewat kebun.",
      },
      {
        title: "Retakan tanah di atas permukiman makin lebar",
        story:
          "Retakan tanah di lereng di atas rumah kami makin lebar setiap hujan. Warga khawatir terjadi longsor susulan.",
      },
    ],
    agency: "Badan Penanggulangan Bencana Daerah {area}",
    places: SLOPE,
  },
  {
    subcategory: "bencana.kekeringan",
    issue: {
      title: "Kekeringan di {kec}, warga membeli air tangki",
      summary:
        "Sumur dan mata air di {kec} mengering sejak kemarau. Warga membeli air tangki dengan harga tinggi, sementara droping air belum rutin.",
    },
    reports: [
      {
        title: "Sumur warga di {kec} kering sejak kemarau",
        story:
          "Sumur di dusun kami kering sejak dua bulan lalu. Kami membeli air tangki yang harganya terus naik.",
      },
      {
        title: "Droping air bersih baru datang sekali sebulan",
        story:
          "Bantuan air bersih baru datang sekali dalam sebulan. Satu tangki dibagi untuk puluhan keluarga dan habis dalam sehari.",
      },
    ],
    agency: "Badan Penanggulangan Bencana Daerah {area}",
    places: DRY,
  },
  {
    subcategory: "bencana.bencana_pesisir",
    issue: {
      title: "Abrasi dan rob merusak rumah warga pesisir {kec}",
      summary:
        "Gelombang tinggi dan rob merusak rumah dan tanggul di pesisir {kec}. Warga meminta tanggul diperbaiki sebelum musim angin barat.",
    },
    reports: [
      {
        title: "Rob masuk rumah warga pesisir setiap sore",
        story:
          "Air laut masuk ke rumah kami setiap sore saat pasang. Lantai rumah sudah kami tinggikan dua kali.",
      },
      {
        title: "Tanggul pantai di {kec} jebol",
        story:
          "Tanggul pantai jebol sepanjang puluhan meter. Abrasi sudah menggerus halaman beberapa rumah.",
      },
    ],
    agency: "Badan Penanggulangan Bencana Daerah {area}",
    places: COAST,
  },
  {
    subcategory: "bencana.infrastruktur_pascabencana",
    issue: {
      title:
        "Jembatan gantung di {kec} belum dibangun ulang setelah banjir bandang",
      summary:
        "Jembatan gantung penghubung dua desa di {kec} putus diterjang banjir bandang. Warga menyeberang sungai dengan rakit.",
    },
    reports: [
      {
        title: "Warga menyeberang sungai dengan rakit",
        story:
          "Jembatan gantung di desa kami putus saat banjir bandang. Anak sekolah sekarang menyeberang sungai dengan rakit bambu.",
      },
      {
        title: "Jembatan putus, hasil panen sulit diangkut",
        story:
          "Petani harus memikul hasil panen memutar sejauh lima kilometer karena jembatan belum dibangun ulang.",
      },
    ],
    agency: "Badan Penanggulangan Bencana Daerah {area}",
    places: ["garut", "cianjur", "banyumas", "malang"],
  },
  {
    subcategory: "bencana.kebutuhan_darurat",
    issue: {
      title: "Posko pengungsian di {kec} kekurangan air minum dan selimut",
      summary:
        "Posko pengungsian di balai desa {kec} menampung ratusan warga. Logistik air minum dan selimut habis sejak hari ketiga.",
    },
    reports: [
      {
        title: "Pengungsi di balai desa kehabisan air minum",
        story:
          "Air minum di posko pengungsian habis sejak kemarin. Banyak anak kecil dan lansia di posko kami.",
      },
      {
        title: "Posko pengungsi belum menerima perlengkapan bayi",
        story:
          "Di posko kami ada belasan bayi. Belum ada kiriman popok dan susu sejak warga mengungsi.",
      },
    ],
    agency: "Badan Penanggulangan Bencana Daerah {area}",
    places: FLOOD,
  },
  {
    subcategory: "bencana.kebakaran_hutan_lahan",
    issue: {
      title: "Kabut asap kebakaran lahan mengganggu warga {kec}",
      summary:
        "Kabut asap dari kebakaran lahan di sekitar {kec} membuat kualitas udara memburuk selama beberapa hari. Warga meminta pembagian masker.",
    },
    reports: [
      {
        title: "Asap kebakaran lahan masuk permukiman",
        story:
          "Asap dari lahan yang terbakar masuk ke permukiman sejak tiga hari lalu. Banyak anak batuk dan sesak napas.",
      },
      {
        title: "Belum ada pembagian masker di {kec}",
        story:
          "Kualitas udara buruk beberapa hari, tetapi belum ada pembagian masker atau posko kesehatan di kelurahan kami.",
      },
    ],
    agency: "Badan Penanggulangan Bencana Daerah {area}",
    places: ["balikpapan"],
  },
  {
    subcategory: "bansos.ketepatan_sasaran",
    issue: {
      title: "Data penerima bansos di {kec} memuat warga yang sudah pindah",
      summary:
        "Warga {kec} menemukan nama penerima yang sudah pindah masih tercatat, sementara keluarga rentan baru belum masuk daftar.",
    },
    reports: [
      {
        title: "Tetangga yang sudah pindah masih terdaftar penerima bansos",
        story:
          "Dalam daftar penerima yang ditempel di balai desa, ada nama keluarga yang sudah pindah dua tahun lalu.",
      },
      {
        title: "Keluarga kami tidak terdaftar meski memenuhi syarat",
        story:
          "Suami saya kehilangan pekerjaan tahun lalu. Kami sudah melapor ke RT, tetapi nama kami belum masuk daftar penerima.",
      },
      {
        title: "Pemutakhiran data bansos di {kec} tidak jelas jadwalnya",
        story:
          "Warga tidak tahu kapan pemutakhiran data dilakukan. Usulan dari RT tidak pernah mendapat kabar.",
      },
    ],
    agency: "Dinas Sosial {area}",
  },
  {
    subcategory: "bansos.keterlambatan_bantuan",
    issue: {
      title: "Bantuan pangan beras di {kec} belum diterima tiga bulan",
      summary:
        "Keluarga penerima manfaat di {kec} belum menerima bantuan beras untuk tiga periode. Informasi jadwal dari desa tidak konsisten.",
    },
    reports: [
      {
        title: "Bantuan beras belum datang tiga bulan",
        story:
          "Kami terdaftar sebagai penerima bantuan beras, tetapi tiga bulan terakhir belum menerima apa pun.",
      },
      {
        title: "Jadwal pembagian bantuan beras berubah-ubah",
        story:
          "Desa sudah dua kali mengumumkan jadwal pembagian beras, lalu membatalkannya tanpa alasan.",
      },
    ],
    agency: "Dinas Sosial {area}",
  },
  {
    subcategory: "bansos.bantuan_pendidikan",
    issue: {
      title: "Dana bantuan pendidikan siswa di {kab} belum cair",
      summary:
        "Siswa penerima bantuan pendidikan di {kab} belum menerima dana semester ini. Sekolah meminta orang tua menunggu tanpa kepastian.",
    },
    reports: [
      {
        title: "Bantuan pendidikan anak kami belum cair semester ini",
        story:
          "Anak saya penerima bantuan pendidikan. Dana semester ini belum masuk rekening, padahal biaya seragam dan buku harus dibayar.",
      },
      {
        title: "Rekening bantuan pendidikan siswa diblokir",
        story:
          "Saat ke bank, rekening bantuan pendidikan anak kami tercatat diblokir. Sekolah tidak tahu cara membukanya.",
      },
    ],
    agency: "Dinas Pendidikan {area}",
  },
  {
    subcategory: "bansos.bantuan_kesehatan",
    issue: {
      title: "Kepesertaan jaminan kesehatan warga {kec} dinonaktifkan",
      summary:
        "Sejumlah warga {kec} baru tahu kepesertaan jaminan kesehatan mereka nonaktif saat berobat. Tidak ada pemberitahuan sebelumnya.",
    },
    reports: [
      {
        title: "Kartu jaminan kesehatan nonaktif saat berobat",
        story:
          "Saya baru tahu kartu jaminan kesehatan saya nonaktif saat mendaftar di rumah sakit. Saya tidak pernah menerima pemberitahuan.",
      },
      {
        title: "Lansia di {kec} harus bayar sendiri biaya berobat",
        story:
          "Ayah saya berusia 70 tahun dan kepesertaannya dinonaktifkan. Biaya cuci darah harus kami bayar sendiri bulan ini.",
      },
    ],
    agency: "Dinas Sosial {area}",
  },
  {
    subcategory: "bansos.distribusi_bantuan",
    issue: {
      title: "Antrean pembagian bantuan di {kec} sampai malam",
      summary:
        "Pembagian bantuan di balai desa {kec} dilakukan dalam satu hari untuk ratusan keluarga. Warga lansia antre sampai malam.",
    },
    reports: [
      {
        title: "Lansia antre bantuan sampai malam di balai desa",
        story:
          "Ibu saya antre dari pagi sampai pukul delapan malam untuk mengambil bantuan. Tidak ada tempat duduk atau air minum.",
      },
      {
        title: "Pembagian bantuan di {kec} tidak memakai nomor antrean",
        story:
          "Tidak ada nomor antrean saat pembagian bantuan. Warga berdesakan dan beberapa orang pingsan.",
      },
    ],
    agency: "Dinas Sosial {area}",
  },
  {
    subcategory: "bansos.penyalahgunaan_bantuan",
    issue: {
      title: "Penerima bansos di {kec} diminta membayar biaya pengambilan",
      summary:
        "Warga {kec} melaporkan permintaan uang saat mengambil bantuan. Besarannya berbeda-beda dan tanpa tanda terima.",
    },
    reports: [
      {
        title: "Diminta uang saat mengambil bantuan",
        story:
          "Saat mengambil bantuan, kami diminta membayar dua puluh ribu rupiah dengan alasan biaya angkut. Tidak ada tanda terima.",
      },
      {
        title: "Potongan bantuan tunai tanpa penjelasan",
        story:
          "Bantuan tunai yang kami terima kurang dari jumlah yang tertulis di surat pemberitahuan. Tidak ada penjelasan soal potongan itu.",
      },
    ],
    agency: "Dinas Sosial {area}",
  },
  {
    subcategory: "bansos.bantuan_korban_bencana",
    issue: {
      title:
        "Bantuan korban banjir belum sampai ke warga bantaran sungai {kec}",
      summary:
        "Warga bantaran sungai di {kec} yang rumahnya rusak akibat banjir belum menerima bantuan, sementara pendataan sudah dilakukan.",
    },
    reports: [
      {
        title: "Korban banjir di bantaran sungai belum terima bantuan",
        story:
          "Rumah kami rusak berat akibat banjir. Petugas sudah mendata sebulan lalu, tetapi bantuan belum diterima.",
      },
      {
        title: "Bantuan banjir hanya sampai jalan utama",
        story:
          "Bantuan dibagikan di jalan utama. Warga di bantaran sungai tidak diberi tahu dan tidak kebagian.",
      },
    ],
    agency: "Dinas Sosial {area}",
    places: FLOOD,
  },
  {
    subcategory: "bansos.perlindungan_kelompok_rentan",
    issue: {
      title: "Lansia tunggal di {kec} belum terdata sebagai penerima bantuan",
      summary:
        "Beberapa lansia yang tinggal sendiri di {kec} belum masuk data penerima bantuan. Mereka bergantung pada tetangga untuk makan.",
    },
    reports: [
      {
        title: "Lansia tinggal sendiri belum pernah dapat bantuan",
        story:
          "Tetangga kami berusia 80 tahun dan tinggal sendiri. Ia belum pernah menerima bantuan apa pun.",
      },
      {
        title: "Penyandang disabilitas di {kec} belum terdata",
        story:
          "Adik saya penyandang disabilitas dan belum terdata sebagai penerima bantuan. Usulan dari RT tidak ada kabar.",
      },
    ],
    agency: "Dinas Sosial {area}",
  },
]

// Admin wording, PLAN §8.3 voice
export const DECISION_TEXTS: {
  readonly reject: readonly (readonly [RejectReason, string])[]
  readonly mark_unverifiable: readonly (readonly [UnverifiableReason, string])[]
} = {
  reject: [
    [
      "standard_2",
      "Masalah yang sama sudah Anda laporkan sebelumnya, jadi kami melanjutkan laporan yang pertama.",
    ],
    [
      "standard_3",
      "Laporan ini menuduh orang yang bisa dikenali. Kirim ulang dengan menjelaskan masalah layanannya, tanpa nama orang.",
    ],
    [
      "standard_4",
      "Laporan ini menyebut nama pegawai yang bukan pejabat. Kirim ulang tanpa nama tersebut.",
    ],
    [
      "standard_11",
      "Laporan ini memuat nomor telepon dan alamat rumah orang lain. Kirim ulang tanpa data pribadi itu.",
    ],
    [
      "out_of_scope",
      "Masalah ini bersifat pribadi, bukan layanan publik. Untuk sengketa pribadi, hubungi lembaga bantuan hukum terdekat.",
    ],
  ],
  mark_unverifiable: [
    [
      "no_evidence",
      "Belum ada foto atau dokumen yang menunjukkan kejadian ini. Anda bisa melapor lagi bila punya bukti baru.",
    ],
    [
      "location_unclear",
      "Lokasi yang disebut belum cukup jelas untuk diperiksa. Sebutkan nama jalan atau desanya bila melapor lagi.",
    ],
    [
      "source_unreachable",
      "Kami belum berhasil memastikan kejadian ini kepada pihak di lokasi dalam masa pemeriksaan.",
    ],
    [
      "conflicting_information",
      "Keterangan yang kami temukan berbeda dengan isi laporan, jadi laporan belum bisa kami pastikan.",
    ],
  ],
}

// Marked sample, never quotes
export const RESPONSE_BODIES: readonly string[] = [
  "[Data sampel] {agency} menyatakan sudah menerima laporan warga dan menjadwalkan peninjauan lokasi dalam dua minggu.\n\nHasil peninjauan akan disampaikan melalui kanal yang sama.",
  "[Data sampel] {agency} menyatakan masalah ini sudah masuk daftar penanganan tahun ini.\n\nWarga diminta melapor lagi bila kondisinya memburuk sebelum penanganan dimulai.",
  "[Data sampel] {agency} menyatakan sudah berkoordinasi dengan kecamatan dan meminta data tambahan dari warga terdampak.",
]

export const ACTION_NOTES: {
  readonly [K in IssueAction]?: readonly string[]
} = {
  claim_resolved: [
    "Instansi menyatakan perbaikan sudah selesai. Penyelesaian menunggu konfirmasi.",
  ],
  confirm_resolved: [
    "Foto lokasi terbaru dari pelapor menunjukkan perbaikan sudah selesai.",
    "Dua pelapor mengonfirmasi bahwa layanan sudah berjalan normal kembali.",
  ],
  reopen: [
    "Pelapor mengirim foto baru yang menunjukkan masalah muncul lagi setelah klaim selesai.",
  ],
  close: [
    "Laporan terbaru menunjukkan masalah ini sudah ditangani pihak lain di luar instansi tujuan.",
    "Isu ini ditutup karena laporannya ternyata menyangkut lokasi di luar wilayah yang disebut.",
  ],
}

// Marked sample, private texts
export const COMPLAINT_TEXTS: {
  readonly [K in ComplaintReason]?: { part: ComplaintPart; text: string }
} = {
  personal_data: {
    part: "title_summary",
    text: "[Data sampel] Ringkasan isu menyebut sekolah dan kelas tertentu sehingga anak-anak di sana mudah dikenali.",
  },
  accusation: {
    part: "responses",
    text: "[Data sampel] Tanggapan yang dikutip seolah menyalahkan kepala unit tertentu, padahal masalahnya ada pada anggaran.",
  },
  false_information: {
    part: "title_summary",
    text: "[Data sampel] Judul isu menyebut masalah belum ditangani, padahal perbaikan sudah mulai minggu lalu.",
  },
  hate: {
    part: "whole",
    text: "[Data sampel] Isi isu ini menyudutkan satu kelompok warga berdasarkan asal daerahnya.",
  },
  political: {
    part: "timeline",
    text: "[Data sampel] Catatan di riwayat isu dipakai untuk mengampanyekan salah satu calon kepala daerah.",
  },
  child_safety: {
    part: "evidence",
    text: "[Data sampel] Salah satu foto bukti menampilkan wajah anak sekolah dengan jelas.",
  },
}

export const COMPLAINT_STATEMENTS: {
  readonly keep: string
  readonly edit: string
  readonly hide: string
  readonly remove: string
} = {
  keep: "[Data sampel] Kami memeriksa judul, ringkasan, dan riwayat isu. Tidak ada bagian yang melanggar pedoman konten.",
  edit: "[Data sampel] Kalimat yang membuat orang mudah dikenali kami hapus dari ringkasan. Bagian lain isu tetap tampil.",
  hide: "[Data sampel] Setelah diperiksa ulang, isu ini kami sembunyikan sampai ringkasannya ditulis ulang tanpa bagian yang melanggar.",
  remove:
    "[Data sampel] Isi isu ini menyudutkan kelompok warga tertentu, jadi isu kami turunkan.",
}

export const APPEAL_TEXT =
  "[Data sampel] Bagian yang saya adukan masih tampil di halaman isu. Mohon diperiksa ulang oleh admin lain."
