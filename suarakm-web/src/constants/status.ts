import type { StatusIsu, Urgensi } from "@/types/domain";

export interface StatusMeta {
  id: StatusIsu;
  label: string;
  labelEn: string;
  deskripsi: string;
  kelas: string; // badge
  titik: string; // dot
}

/** Urutan alur PDF §20: Reported → Verified → In Progress → Government Responded → Resolved */
export const STATUS: StatusMeta[] = [
  {
    id: "dilaporkan",
    label: "Dilaporkan",
    labelEn: "Reported",
    deskripsi: "Laporan masuk dan menunggu verifikasi tim.",
    kelas: "bg-[#ece6d2] text-km-navy",
    titik: "bg-tinta-500",
  },
  {
    id: "terverifikasi",
    label: "Terverifikasi",
    labelEn: "Verified",
    deskripsi: "Bukti dan informasi telah diperiksa tim verifikator.",
    kelas: "bg-biru-100 text-biru-600",
    titik: "bg-biru-500",
  },
  {
    id: "diproses",
    label: "Dalam Proses",
    labelEn: "In Progress",
    deskripsi: "Isu sedang dikawal dan diteruskan ke instansi terkait.",
    kelas: "bg-km-blue text-white",
    titik: "bg-km-blue",
  },
  {
    id: "direspons",
    label: "Direspons Pemerintah",
    labelEn: "Government Responded",
    deskripsi: "Instansi terkait sudah memberikan tanggapan resmi.",
    kelas: "bg-km-navy text-white",
    titik: "bg-km-navy",
  },
  {
    id: "selesai",
    label: "Selesai",
    labelEn: "Resolved",
    deskripsi: "Persoalan dinyatakan tertangani dan dievaluasi publik.",
    kelas: "bg-km-green text-white",
    titik: "bg-hijau-600",
  },
];

export const STATUS_MAP = Object.fromEntries(STATUS.map((s) => [s.id, s])) as Record<StatusIsu, StatusMeta>;
export const STATUS_URUTAN: StatusIsu[] = STATUS.map((s) => s.id);

export const URGENSI: { id: Urgensi; label: string; kelas: string }[] = [
  { id: "rendah", label: "Rendah", kelas: "bg-[#ece6d2] text-km-navy" },
  { id: "sedang", label: "Sedang", kelas: "bg-[#ece6d2] text-km-navy" },
  { id: "tinggi", label: "Tinggi", kelas: "bg-merah-100 text-merah-900" },
  { id: "darurat", label: "Darurat", kelas: "bg-km-red text-white" },
];

export const URGENSI_MAP = Object.fromEntries(URGENSI.map((u) => [u.id, u])) as Record<
  Urgensi,
  (typeof URGENSI)[number]
>;
