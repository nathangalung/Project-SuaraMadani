import { z } from "zod";

/** Skema formulir KM Lapor! — mengikuti PDF §7, §10–§13 */

export const PERAN_PELAPOR = [
  { id: "korban", label: "Saya adalah pelapor/korban langsung" },
  { id: "mewakili", label: "Saya melaporkan untuk mewakili korban/pelapor" },
  { id: "saksi", label: "Saya melaporkan sebagai saksi/pihak yang mengetahui kejadian" },
] as const;

export const PERSETUJUAN_DIWAKILI = [
  { id: "persetujuan", label: "Ya, saya sudah mendapat persetujuan dari pihak yang saya wakili" },
  { id: "hubungan", label: "Ya, saya punya hubungan langsung (keluarga, pendamping, pengurus komunitas)" },
  { id: "tidak", label: "Belum, saya belum mendapat persetujuan" },
] as const;

export const KELOMPOK_TERDAMPAK = [
  "Anak-anak",
  "Lansia",
  "Penyandang disabilitas",
  "Perempuan",
  "Pelajar/mahasiswa",
  "Pekerja",
  "Petani/nelayan",
  "Masyarakat umum",
] as const;

export const ESTIMASI_TERDAMPAK = [
  { id: "1-10", label: "1–10 orang" },
  { id: "11-100", label: "11–100 orang" },
  { id: "101-1000", label: "101–1.000 orang" },
  { id: "1001-10000", label: "1.001–10.000 orang" },
  { id: ">10000", label: "Lebih dari 10.000 orang" },
  { id: "tidak-tahu", label: "Tidak tahu" },
] as const;

export const METODE_KONTAK = ["WhatsApp", "Telepon", "Email"] as const;

export const PERSETUJUAN_AKHIR = [
  { id: "akurat", label: "Saya memastikan informasi yang saya berikan sesuai dengan pengetahuan saya." },
  { id: "agregat", label: "Saya memahami bahwa laporan dapat digunakan untuk analisis dan advokasi publik dalam bentuk agregat." },
  { id: "privasi", label: "Saya memahami bahwa identitas dan informasi kontak saya tidak akan ditampilkan secara publik tanpa persetujuan." },
  { id: "belumVerifikasi", label: "Saya memahami bahwa pengiriman laporan tidak secara otomatis berarti laporan telah terverifikasi." },
] as const;

const wajib = (pesan: string) => z.string().trim().min(1, pesan);
const centang = z.literal(true, { errorMap: () => ({ message: "Wajib dicentang sebelum mengirim." }) });

export const laporSchema = z
  .object({
    // Step 1 — Identitas submitter
    peran: z.enum(["korban", "mewakili", "saksi"], { required_error: "Pilih peranmu dalam laporan ini." }),
    persetujuanDiwakili: z.enum(["persetujuan", "hubungan", "tidak"]).optional(),
    keteranganDiwakili: z.string().trim().max(200).optional(),

    // Step 2 — Lokasi (§10)
    sumberLokasi: z.enum(["gps", "manual"]).default("manual"),
    provinsiId: wajib("Pilih provinsi."),
    kabupaten: wajib("Isi kabupaten/kota."),
    kecamatan: wajib("Isi kecamatan."),
    kelurahan: z.string().trim().optional(),
    /** koordinat presisi hanya untuk tim verifikasi, tidak pernah ditampilkan publik */
    koordinat: z.object({ lat: z.number(), lng: z.number() }).optional(),

    // Step 3 — Detail laporan (§11)
    judul: z.string().trim().min(10, "Judul minimal 10 karakter.").max(120, "Judul maksimal 120 karakter."),
    deskripsi: z.string().trim().min(40, "Ceritakan minimal 40 karakter supaya tim bisa memahami persoalannya."),
    kategori: z.enum(["program", "bencana", "bansos"], { required_error: "Pilih kategori." }),
    subkategori: wajib("Pilih subkategori."),
    waktuKejadian: wajib("Isi tanggal kejadian."),
    instansi: z.string().trim().optional(),
    urgensi: z.enum(["rendah", "sedang", "tinggi", "darurat"], { required_error: "Pilih tingkat urgensi." }),

    // Dampak
    kelompokTerdampak: z.array(z.string()).min(1, "Pilih minimal satu kelompok."),
    estimasiTerdampak: wajib("Pilih estimasi jumlah terdampak."),
    dampakKehidupan: z.string().trim().min(10, "Jelaskan dampaknya minimal 10 karakter."),
    masihBerlangsung: z.enum(["ya", "tidak", "tidak-tahu"], { required_error: "Pilih salah satu." }),

    // Bukti
    lampiran: z.array(z.custom<File>((v) => typeof File !== "undefined" && v instanceof File)).max(5, "Maksimal 5 berkas.").default([]),
    linkSumber: z.array(z.object({ url: z.string().trim().url("Tautan tidak valid.").or(z.literal("")) })).default([]),

    // Step — Kontak & follow-up (§12)
    bersediaDihubungi: z.enum(["ya", "tidak"], { required_error: "Pilih ya atau tidak." }),
    telepon: z.string().trim().optional(),
    whatsapp: z.string().trim().optional(),
    emailKontak: z.string().trim().email("Email tidak valid.").or(z.literal("")).optional(),
    metodeKontak: z.enum(METODE_KONTAK).optional(),
    izinDihubungi: z.boolean().optional(),

    // Consent & privacy (§13)
    setuju: z.object({
      akurat: centang,
      agregat: centang,
      privasi: centang,
      belumVerifikasi: centang,
    }),
  })
  .superRefine((v, ctx) => {
    if (v.peran === "mewakili" && !v.persetujuanDiwakili) {
      ctx.addIssue({ code: "custom", path: ["persetujuanDiwakili"], message: "Jawab pertanyaan ini dulu." });
    }
    if (v.bersediaDihubungi === "ya") {
      if (!v.telepon && !v.whatsapp && !v.emailKontak) {
        ctx.addIssue({ code: "custom", path: ["whatsapp"], message: "Isi minimal satu kontak." });
      }
      if (!v.metodeKontak) {
        ctx.addIssue({ code: "custom", path: ["metodeKontak"], message: "Pilih metode yang kamu sukai." });
      }
    }
  });

/** Field yang divalidasi per langkah (untuk tombol "Lanjut") */
export const FIELD_PER_LANGKAH = [
  ["peran", "persetujuanDiwakili", "keteranganDiwakili"],
  ["provinsiId", "kabupaten", "kecamatan", "kelurahan"],
  ["judul", "deskripsi", "kategori", "subkategori", "waktuKejadian", "instansi", "urgensi"],
  ["kelompokTerdampak", "estimasiTerdampak", "dampakKehidupan", "masihBerlangsung"],
  ["lampiran", "linkSumber"],
  ["bersediaDihubungi", "telepon", "whatsapp", "emailKontak", "metodeKontak", "izinDihubungi"],
  ["setuju"],
] as const;

export const LANGKAH = [
  { judul: "Identitas", deskripsi: "Peranmu dalam laporan" },
  { judul: "Lokasi", deskripsi: "Di mana persoalan terjadi" },
  { judul: "Detail", deskripsi: "Apa yang terjadi" },
  { judul: "Dampak", deskripsi: "Siapa yang terdampak" },
  { judul: "Bukti", deskripsi: "Foto, video, dokumen, tautan" },
  { judul: "Kontak", deskripsi: "Tindak lanjut (opsional)" },
  { judul: "Kirim", deskripsi: "Persetujuan & privasi" },
] as const;
