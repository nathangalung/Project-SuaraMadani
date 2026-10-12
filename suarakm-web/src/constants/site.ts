export const SITE = {
  nama: "SuaraKM",
  domain: "suarakm.id",
  fiturLapor: "KM Lapor!",
  tagline: "Laporkan. Pantau. Suarakan.",
  heroBaris1: "Suara kamu, tercatat dan terpantau.",
  heroBaris2: "Tuntutan publik, terdokumentasi dan terbaharukan.",
  subheadline:
    "Laporkan persoalan yang terjadi di sekitarmu dan pantau bagaimana isu tersebut berkembang, ditindaklanjuti, dan dievaluasi bersama.",
  deskripsi:
    "Platform publik untuk melaporkan, memantau, dan mengevaluasi respons pemerintah terhadap persoalan masyarakat Indonesia.",
  kabinet: "Kabinet KM ITB 2026/2027",
  kredit: {
    poweredBy: "KM ITB",
    creditBy: "CSTS — Center for Science, Technology and Society, KM ITB",
    developedBy: "xx & Team",
  },
  kontak: {
    email: "kabinet@km.itb.ac.id",
    instagram: "https://instagram.com/km.itb",
  },
} as const;

export const NAV_UTAMA = [
  { label: "Beranda", to: "/" },
  { label: "KM Lapor!", to: "/lapor" },
  { label: "Jelajah Isu", to: "/jelajah" },
  { label: "Dashboard", to: "/dashboard" },
  { label: "Tentang", to: "/tentang" },
] as const;
