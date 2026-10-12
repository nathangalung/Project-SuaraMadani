import type { KategoriId } from "@/types/domain";

export interface KategoriMeta {
  id: KategoriId;
  label: string;
  labelPendek: string;
  deskripsi: string;
  /** kelas tailwind untuk aksen */
  warna: { teks: string; latar: string; garis: string; hex: string; solid: string };
  subkategori: string[];
}

/** PDF §9 — Kategori Isu */
export const KATEGORI: KategoriMeta[] = [
  {
    id: "program",
    label: "Kritik Program Pemerintah, Pelayanan & Kebutuhan Dasar",
    labelPendek: "Program & Pelayanan",
    deskripsi: "Kebijakan publik, layanan dasar, harga, pekerjaan, dan program pemerintah.",
    warna: { teks: "text-biru-600", latar: "bg-biru-100", garis: "bg-biru-500", hex: "#176bff", solid: "bg-km-blue text-white" },
    subkategori: [
      "Program pemerintah",
      "Kebijakan publik",
      "Pendidikan",
      "Kesehatan",
      "Transportasi",
      "Infrastruktur",
      "Air bersih",
      "Sanitasi",
      "Energi",
      "Administrasi publik",
      "Pelayanan pemerintah",
      "Harga dan daya beli",
      "Pangan",
      "Perumahan",
      "Pekerjaan",
      "Kebutuhan dasar lainnya",
    ],
  },
  {
    id: "bencana",
    label: "Kebencanaan & Tanggap Darurat",
    labelPendek: "Kebencanaan",
    deskripsi: "Bencana alam, evakuasi, kebutuhan darurat, dan pemulihan pascabencana.",
    warna: { teks: "text-merah-500", latar: "bg-merah-100", garis: "bg-merah-500", hex: "#d81623", solid: "bg-km-red text-white" },
    subkategori: [
      "Banjir",
      "Longsor",
      "Kebakaran hutan/lahan",
      "Gempa bumi",
      "Erupsi",
      "Kekeringan",
      "Bencana pesisir",
      "Bencana lainnya",
      "Evakuasi",
      "Kebutuhan darurat",
      "Respons pemerintah",
      "Infrastruktur pascabencana",
    ],
  },
  {
    id: "bansos",
    label: "Bantuan Sosial & Perlindungan Masyarakat",
    labelPendek: "Bantuan Sosial",
    deskripsi: "Penyaluran, ketepatan sasaran, dan perlindungan kelompok rentan.",
    warna: { teks: "text-[#9c1a77]", latar: "bg-pink-100", garis: "bg-[#c8279a]", hex: "#c8279a", solid: "bg-[#c8279a] text-white" },
    subkategori: [
      "Bansos",
      "Bantuan pangan",
      "Bantuan pendidikan",
      "Bantuan kesehatan",
      "Perlindungan kelompok rentan",
      "Bantuan korban bencana",
      "Ketepatan sasaran penerima",
      "Distribusi bantuan",
      "Keterlambatan bantuan",
      "Penyalahgunaan/ketidaksesuaian bantuan",
    ],
  },
];

export const KATEGORI_MAP = Object.fromEntries(KATEGORI.map((k) => [k.id, k])) as Record<
  KategoriId,
  KategoriMeta
>;
