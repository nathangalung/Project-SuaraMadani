import type { CSSProperties, ReactNode } from "react";
import { SITE } from "@/constants/site";
import { ButtonLink } from "@/components/ui";
import { cn } from "@/lib/cn";

/** PDF §3 */
const TUJUAN = [
  { judul: "Membuka akses pelaporan publik", isi: "Kanal yang mudah, transparan, dan dapat diakses masyarakat Indonesia untuk melaporkan persoalan yang dialami maupun disaksikan." },
  { judul: "Mendokumentasikan persoalan publik", isi: "Setiap laporan menjadi bagian dari basis data isu publik yang dapat dianalisis berdasarkan jenis isu, lokasi, waktu, kelompok terdampak, dan status penanganan." },
  { judul: "Membangun public issue tracking", isi: "Masyarakat dapat melihat bagaimana persoalan berkembang dari laporan menjadi tuntutan, serta bagaimana respons dan tindakan pemerintah terhadapnya." },
  { judul: "Mendorong transparansi pemerintah", isi: "Dashboard publik menampilkan jumlah laporan, isu prioritas, status penyelesaian, respons pemerintah, dan evaluasi masyarakat." },
  { judul: "Menjadi basis advokasi berbasis data", isi: "Data agregat dipakai KM ITB sebagai dasar kajian, advokasi, policy brief, diskusi publik, dan rekomendasi kebijakan." },
];

/** PDF §4 */
const PRINSIP = [
  { judul: "Accessible", isi: "Dapat digunakan masyarakat dari berbagai latar belakang." },
  { judul: "Transparent", isi: "Status dan perkembangan isu dapat dipantau secara terbuka." },
  { judul: "Accountable", isi: "Setiap perubahan status dan respons terdokumentasi." },
  { judul: "Evidence-based", isi: "Pelaporan didorong untuk menyertakan bukti dan informasi yang relevan." },
  { judul: "Privacy-conscious", isi: "Identitas pelapor tidak ditampilkan secara publik tanpa persetujuan." },
  { judul: "Non-partisan", isi: "Berorientasi pada kepentingan publik dan evaluasi kebijakan, bukan politik praktis." },
  { judul: "Data-driven", isi: "Data laporan diolah menjadi insight mengenai persoalan masyarakat." },
];

const VERIFIKASI = [
  { judul: "Email terverifikasi", isi: "Setiap pelapor masuk dengan email yang dikonfirmasi lewat kode OTP." },
  { judul: "Akun", isi: "Laporan terhubung ke akun sehingga bisa dilacak dan tidak mudah dipalsukan." },
  { judul: "Verifikasi tambahan (opsional)", isi: "Untuk laporan berdampak tinggi, tim dapat meminta konfirmasi lanjutan — tanpa mewajibkan identitas sensitif." },
];

const DITAMPILKAN = [
  "Judul, kategori, dan ringkasan isu",
  "Wilayah sampai tingkat kecamatan",
  "Jumlah laporan, warga terdampak, dan dukungan",
  "Riwayat status dan respons pemerintah",
  "Skor kepuasan publik (agregat)",
];
const TIDAK_DITAMPILKAN = [
  "Nama, email, dan nomor kontak pelapor",
  "Titik lokasi presisi rumah atau individu",
  "Identitas pihak yang diwakili pelapor",
  "NIK — tidak diwajibkan; bila dipakai untuk verifikasi tambahan, disimpan sebagai data sensitif",
  "Bukti yang memuat data pribadi sebelum disamarkan",
];

const PENGAMAN_SKOR = ["Satu suara per akun", "Pembatasan laju (rate limiting)", "CAPTCHA/anti-bot", "Deteksi anomali", "Audit log setiap suara"];

const MODERASI = ["Spam", "Laporan palsu", "Doxing", "Ujaran kebencian", "Fitnah", "Manipulasi voting", "Konten ilegal", "Duplikasi laporan"];

/*
 * Tentang meniru halaman Kabinet km.itb.ac.id/pusat/kabinet-km-itb (dipilih user dari 3 referensi):
 *  - hero: label biru "KABINET KM ITB", judul raksasa campuran Aleo/Tilt Warp bercahaya ungu di atas strip biru
 *  - band biru penuh per bab ("TUJUAN & PRINSIP", ...) dengan judul bercahaya yang sama
 *  - kotak pastel ala kotak "Visi", kartu putih berlatar pastel ala kartu "Misi" dengan bingkai nomor biru
 * Aset latar/ornamen diambil dari km.itb.ac.id (lihat public/tentang/SUMBER.txt).
 */

const CAHAYA: CSSProperties = { textShadow: "0px 0px 52.6px #A500FD, 0px 3px 4px rgba(255, 255, 255, 0.89)" };

/** Judul gaya KM: potongan huruf bergantian Aleo ↔ Tilt Warp, mulai dari Aleo (mis. ["V", "IS", "I & M", "IS", "I"]) */
function HurufCampur({ potongan, aleo, tilt }: { potongan: string[]; aleo?: string; tilt?: string }) {
  return potongan.map((p, i) =>
    i % 2 === 0 ? (
      <span key={i} className="font-sans" style={{ fontSize: aleo }}>
        {p}
      </span>
    ) : (
      <span key={i} className="font-judul" style={{ fontSize: tilt }}>
        {p}
      </span>
    ),
  );
}

/** Subjudul bercahaya dengan strip biru di 65% bawah (judul "VISI"/"MISI" di halaman Kabinet) */
function SubJudul({ id, potongan, className }: { id?: string; potongan: string[]; className?: string }) {
  return (
    <h3 id={id} className={cn("relative z-10 flex justify-center", className)}>
      <span className="relative inline-block px-1 lg:px-2">
        <span aria-hidden className="absolute inset-x-0 top-[35%] bottom-0 -z-10 bg-km-blue" />
        <span className="block text-center leading-[1.1] font-normal text-white uppercase" style={{ ...CAHAYA, fontSize: "clamp(28px, 4vw, 48px)" }}>
          <HurufCampur potongan={potongan} />
        </span>
      </span>
    </h3>
  );
}

/** Band biru penuh pembuka tiap bab ("VISI & MISI") */
function Band({ id, potongan }: { id: string; potongan: string[] }) {
  return (
    <div className="bg-km-blue px-4 pt-8 pb-2 lg:pt-2 lg:pb-3">
      <h2 id={id} className="text-center text-[36px] leading-[1.2] font-normal text-white uppercase sm:text-[52px] md:text-[64px] lg:text-[79px]" style={CAHAYA}>
        <HurufCampur potongan={potongan} />
      </h2>
    </div>
  );
}

/** Kotak pastel di tengah (kotak "Visi") */
function KotakPastel({ judul, children }: { judul: string[]; children: ReactNode }) {
  return (
    <div className="relative isolate mx-auto mt-6 flex max-w-[700px] flex-col items-center overflow-hidden px-6 py-6 shadow-xl sm:px-8 lg:mt-10 lg:px-12 lg:py-8">
      <img src="/tentang/background-visi.webp" alt="" aria-hidden className="absolute inset-0 -z-10 size-full object-cover" />
      <SubJudul potongan={judul} className="mb-3 lg:mb-4" />
      <div className="max-w-[540px] text-center leading-[1.7] text-km-navy lg:text-[17px]">{children}</div>
    </div>
  );
}

/** Kartu putih berlatar pastel (kartu "Misi"); nomor dalam bingkai biru KM bila ada */
function KartuMisi({ nomor, judul, children, className }: { nomor?: number; judul?: string; children: ReactNode; className?: string }) {
  return (
    <li className={cn("relative isolate flex flex-col overflow-hidden bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)] lg:p-6", className)}>
      <img src="/tentang/background-misi.webp" alt="" aria-hidden className="absolute inset-0 -z-10 size-full object-cover" />
      {nomor !== undefined && (
        <span className="relative mb-3 grid size-9 place-items-center text-lg font-bold text-white lg:mb-4 lg:size-[42px] lg:text-[22px]">
          <span
            aria-hidden
            className="absolute inset-0 -z-10 bg-km-blue [mask-image:url(/tentang/frame-penomoran-visi.webp)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
          />
          {nomor}
        </span>
      )}
      {judul && <h4 className="mb-1.5 font-bold text-km-navy">{judul}</h4>}
      <div className="text-[0.95rem] leading-[1.6] text-km-navy">{children}</div>
    </li>
  );
}

const orn = "pointer-events-none absolute select-none";

export default function TentangPage() {
  return (
    <>
      {/* Hero */}
      <section aria-labelledby="tentang-judul" className="relative isolate overflow-hidden">
        <img src="/tentang/bg-element-2.webp" alt="" aria-hidden className={`${orn} inset-0 -z-10 size-full object-cover`} />
        <img src="/tentang/blend-group-12.webp" alt="" aria-hidden className={`${orn} top-[30%] left-1/2 hidden w-[150px] -translate-x-[420px] -rotate-[30deg] lg:block`} />
        <img src="/tentang/blend-group-12.webp" alt="" aria-hidden className={`${orn} top-[18%] left-1/2 hidden w-[90px] translate-x-[360px] rotate-12 lg:block`} />
        <div className="flex flex-col items-center px-4 pt-10 pb-20 text-center lg:pt-16 lg:pb-28">
          <p className="bg-km-blue px-4 py-1 text-white sm:px-8 sm:py-1.5" style={{ fontSize: "clamp(16px, 4vw, 28px)", lineHeight: "140%" }}>
            {SITE.kabinet.toUpperCase()}
          </p>
          <div className="relative z-10 mt-4 px-2 lg:mt-6">
            <span aria-hidden className="absolute inset-x-0 top-[35%] bottom-[10%] -z-10 bg-km-blue" />
            <h1 id="tentang-judul" className="text-center leading-[1.1] font-normal text-white" style={CAHAYA}>
              <span className="sr-only">Tentang </span>
              <HurufCampur potongan={["S", "UARA", "K", "M"]} aleo="clamp(48px, 8.7vw, 125px)" tilt="clamp(52px, 9.4vw, 135px)" />
            </h1>
          </div>
          <p className="mt-8 max-w-2xl text-[clamp(1.05rem,1.8vw,1.35rem)] leading-snug font-medium text-km-navy">{SITE.subheadline}</p>
        </div>
      </section>

      {/* Bab 1: Tujuan & Prinsip */}
      <section aria-labelledby="bab-tujuan" className="relative overflow-hidden bg-km-cream">
        <Band id="bab-tujuan" potongan={["T", "UJUAN", " & P", "RINSIP"]} />
        <div className="relative px-4 pb-16 sm:px-6 lg:px-8 lg:pb-24">
          <img src="/tentang/ellipse-53.svg" alt="" aria-hidden className={`${orn} top-[12%] left-[5%] hidden w-[clamp(60px,7vw,140px)] rotate-12 lg:block`} />
          <img src="/tentang/ellipse-49.svg" alt="" aria-hidden className={`${orn} top-[55%] right-[8%] hidden w-[clamp(60px,7vw,140px)] lg:block`} />

          <KotakPastel judul={["T", "ENTANG"]}>
            “Ruang digital bagi masyarakat Indonesia untuk menyampaikan laporan, kritik, kebutuhan, dan tuntutan terhadap kinerja pemerintah —
            secara terbuka, terstruktur, terdokumentasi, dan dapat dipantau perkembangannya.”
          </KotakPastel>

          <SubJudul potongan={["T", "UJUAN"]} className="my-8 lg:my-12" />
          <ol className="relative z-10 mx-auto grid max-w-[1080px] gap-4 sm:grid-cols-4 lg:grid-cols-6 lg:gap-6">
            {TUJUAN.map((t, i) => (
              <KartuMisi key={t.judul} nomor={i + 1} judul={t.judul} className={cn("sm:col-span-2", i === 4 && "sm:col-start-2 lg:col-start-auto", i === 3 && "lg:col-start-2")}>
                {t.isi}
              </KartuMisi>
            ))}
          </ol>

          <SubJudul potongan={["P", "RINSIP"]} className="my-8 lg:my-12" />
          <ul className="relative z-10 mx-auto grid max-w-[1080px] gap-4 sm:grid-cols-2 lg:grid-cols-8 lg:gap-6">
            {PRINSIP.map((p, i) => (
              <KartuMisi key={p.judul} judul={p.judul} className={cn("lg:col-span-2", i === 4 && "lg:col-start-2")}>
                {p.isi}
              </KartuMisi>
            ))}
          </ul>
        </div>
      </section>

      {/* Bab 2: Verifikasi & Privasi */}
      <section id="metode" aria-labelledby="bab-verifikasi" className="relative scroll-mt-24 overflow-hidden bg-km-cream">
        <Band id="bab-verifikasi" potongan={["V", "ERIFIKASI", " & P", "RIVASI"]} />
        <div className="relative px-4 pb-16 sm:px-6 lg:px-8 lg:pb-24">
          <img src="/tentang/ellipse-49.svg" alt="" aria-hidden className={`${orn} top-[20%] right-[6%] hidden w-[clamp(60px,7vw,140px)] lg:block`} />

          <SubJudul potongan={["V", "ERIFIKASI"]} className="mt-10 mb-8 lg:mt-14 lg:mb-12" />
          <ol className="relative z-10 mx-auto grid max-w-[1080px] gap-4 sm:grid-cols-3 lg:gap-6">
            {VERIFIKASI.map((v, i) => (
              <KartuMisi key={v.judul} nomor={i + 1} judul={v.judul}>
                {v.isi}
              </KartuMisi>
            ))}
          </ol>

          <KotakPastel judul={["S", "KOR"]}>
            <p>
              Setelah pemerintah merespons, warga menjawab “Seberapa puas Anda terhadap penanganan pemerintah terhadap isu ini?” pada skala 1–5.
              Skor yang tampil adalah rata-rata semua penilaian.
            </p>
            <p className="mt-3 text-[0.95rem]">
              Dijaga dengan {PENGAMAN_SKOR.map((x) => (x === "CAPTCHA/anti-bot" ? x : x[0].toLowerCase() + x.slice(1))).join(", ")}. Skor ini
              adalah sentimen publik, bukan ukuran objektif tunggal keberhasilan pemerintah.
            </p>
          </KotakPastel>

          <SubJudul id="privasi" potongan={["P", "RIVASI"]} className="mt-12 mb-4 scroll-mt-28 lg:mt-16" />
          <p className="relative z-10 mx-auto mb-8 max-w-2xl text-center leading-[1.7] text-km-navy lg:mb-12">
            Untuk dashboard publik, lokasi diagregasikan sampai Provinsi › Kabupaten/Kota › Kecamatan atau ditampilkan sebagai heatmap.
          </p>
          <ul className="relative z-10 mx-auto grid max-w-[1080px] gap-4 md:grid-cols-2 lg:gap-6">
            {[
              { judul: "Ditampilkan ke publik", isi: DITAMPILKAN },
              { judul: "Tidak pernah ditampilkan", isi: TIDAK_DITAMPILKAN },
            ].map((k) => (
              <KartuMisi key={k.judul} judul={k.judul}>
                <ul className="mt-1 list-disc space-y-1.5 pl-5 marker:text-km-blue">
                  {k.isi.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </KartuMisi>
            ))}
          </ul>
          <p className="relative z-10 mx-auto mt-10 max-w-3xl text-center leading-relaxed text-km-navy">
            Laporan berisi {MODERASI.join(", ").toLowerCase().replace(/, ([^,]*)$/, ", atau $1")} akan ditolak atau disunting.
          </p>
        </div>
      </section>

      {/* Bab 3: Pengelola */}
      <section aria-labelledby="bab-pengelola" className="relative overflow-hidden bg-km-cream">
        <Band id="bab-pengelola" potongan={["P", "ENGELOLA"]} />
        <div className="relative px-4 pt-10 pb-16 text-center sm:px-6 lg:px-8 lg:pt-14 lg:pb-24">
          <img src="/tentang/ellipse-53.svg" alt="" aria-hidden className={`${orn} top-[25%] left-[8%] hidden w-[clamp(60px,7vw,120px)] -rotate-45 lg:block`} />
          <p className="text-2xl font-bold text-km-navy sm:text-3xl">Keluarga Mahasiswa ITB</p>
          <p className="mt-1 font-ui text-lg font-semibold text-km-navy/80">{SITE.kabinet}</p>
          <ul className="relative z-10 mx-auto mt-10 grid max-w-[1080px] gap-4 text-left sm:grid-cols-3 lg:gap-6">
            {[
              ["Powered by", SITE.kredit.poweredBy],
              ["Credit by", SITE.kredit.creditBy],
              ["Developed by", SITE.kredit.developedBy],
            ].map(([k, v]) => (
              <KartuMisi key={k}>
                <span className="block font-ui text-sm text-tinta-600">{k}</span>
                <span className="mt-1 block font-bold">{v}</span>
              </KartuMisi>
            ))}
          </ul>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <ButtonLink to="/lapor" varian="kuning" ukuran="lg">
              Buat laporan
            </ButtonLink>
            <a
              href={`mailto:${SITE.kontak.email}`}
              className="inline-flex h-13 items-center rounded-[10px] border-2 border-km-navy bg-white px-7 text-lg font-semibold text-km-navy hover:bg-km-navy hover:text-white"
            >
              Hubungi tim
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
