import type { Tuntutan } from "@/types/domain";

/** DATA CONTOH — tuntutan publik yang disusun dari isu terverifikasi. */
export const TUNTUTAN: Tuntutan[] = [
  {
    id: "TNT-01",
    judul: "Buka data penerima bansos per desa",
    ringkasan: "Publikasi daftar penerima (tersamarkan) dan jadwal penyaluran agar warga bisa mengawasi ketepatan sasaran.",
    policyBriefUrl: "#",
    direspons: true,
    dipenuhi: false,
    isuTerkait: ["ISU-0137", "ISU-0125", "ISU-0070"],
    diajukan: "2026-08-12",
  },
  {
    id: "TNT-02",
    judul: "Posko kesehatan & masker gratis saat kabut asap",
    ringkasan: "Penyediaan posko kesehatan dan masker standar di daerah dengan kualitas udara berbahaya.",
    policyBriefUrl: "#",
    direspons: false,
    dipenuhi: false,
    isuTerkait: ["ISU-0119"],
    diajukan: "2026-09-08",
  },
  {
    id: "TNT-03",
    judul: "Standar layanan minimum air bersih",
    ringkasan: "Penetapan standar waktu pemulihan suplai air dan kewajiban tangki air bantuan saat gangguan.",
    policyBriefUrl: "#",
    direspons: true,
    dipenuhi: true,
    isuTerkait: ["ISU-0142", "ISU-0092"],
    diajukan: "2026-07-30",
  },
  {
    id: "TNT-04",
    judul: "Percepatan dana stimulan rumah pascagempa",
    ringkasan: "Batas waktu pencairan dana stimulan dan publikasi progres verifikasi kerusakan rumah.",
    policyBriefUrl: "#",
    direspons: false,
    dipenuhi: false,
    isuTerkait: ["ISU-0109"],
    diajukan: "2026-09-25",
  },
];
