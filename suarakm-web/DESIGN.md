# Panduan Desain SuaraKM

Acuan tunggal: **km.itb.ac.id** — terutama beranda dan `/pusat/kabinet-km-itb`.
(Gaya maknaprice.my.id sudah **ditolak**; desain pertama dinilai "terlalu AI".)

Screenshot acuan (scratchpad sesi pengembangan):
`ref/kmfull_b.png` (judul seksi + tombol + footer), `ref/kmkab_b.png` (pita biru + kartu Visi/Misi), `ref/kmm_a.png` (mobile).

## Aturan warna (paling penting)

- **Dasar:** latar krem `#fff8e5`, kartu putih, teks navy `#08266e`.
- **Satu aksen: biru KM `#176bff`** — tombol, nomor, status aktif, tautan, kotak judul hero, pita judul halaman.
- **Warna bermakna saja:** hijau = sudah/selesai, merah = belum/darurat. Warna lain tidak membawa arti.
- Kuning/mint hanya di gradien navbar & pita melengkung hero (ciri KM). Tidak dipakai di konten.
- Kategori = chip netral + kotak kecil warna kategori (sama dengan warna di peta/grafik).
- Pink, ungu, marun, lime, oranye: token tetap ada, **tidak dipakai** di komponen.

## Aturan kotak

- **Kotak hanya untuk objek:** sesuatu yang bisa diklik (kartu isu → halaman detail), diisi (panel formulir), atau panel dashboard dari wireframe PDF.
- **Daftar, langkah, statistik, prinsip, tuntutan → garis tipis**, bukan kotak: `GridGaris` (garis navy 2px di atas, 1px antarbaris) atau tabel bergaris (`TuntutanLedger`).
- **Tanpa bayangan** di konten. Tepi kotak = `border border-km-navy/12`; hover kartu-link = `hover:border-km-navy`.
- Kedalaman dari kontras permukaan (krem / putih / blok navy / blok biru), bukan bayangan atau gradien.
- Nomor kotak biru (`Nomor`) hanya di stepper formulir. Di daftar pakai angka biasa `01, 02…` warna biru.
- Status ya/tidak = ikon + kata hijau/merah (`Indikator`), bukan blok warna.

Inspirasi: teenage engineering (pita bergaris, 0 radius), Notion & Perplexity (garis tepi tipis, bukan bayangan), Intercom (register editorial) — dari styles.refero.design.

## Judul seksi

`<SectionHeading judul deskripsi aksi rata gelap />` — Tilt Warp, huruf kalimat biasa ("Isu terbaru"), navy, rata kiri sejajar grid.
Tanpa kotak warna, pendar, huruf campuran, atau label kecil di atasnya. (Gaya kotak miring ala KM sudah dicoba dan ditolak: ramai & susah dibaca.)

## Ciri khas yang WAJIB dipakai

| Elemen | Cara KM | Komponen kita |
|---|---|---|
| Judul halaman | Pita biru `#176bff` selebar layar, teks putih berpendar | `<PageHeader judul label deskripsi />` (sudah termasuk area pita melengkung) |
| Kartu | **Sudut tajam**, garis tepi tipis, tanpa bayangan; hanya untuk objek (lihat Aturan kotak) | `<Card varian="pastel" | "putih" | "navy">` |
| Nomor urut | Angka biasa `01` biru di daftar; kotak biru hanya di stepper formulir | `GridGaris`, `<Nomor>` |
| Label/tag | Persegi; status & kategori netral/biru, hijau/merah hanya untuk ya/tidak | `<Label warna>`, `StatusBadge`, `KategoriBadge`, `UrgensiBadge` |
| Tombol | **Biru KM solid** (bukan gradien — teks putih di atas mint tidak terbaca), sudut 10px, Tilt Warp putih, bayangan tebal biru tua di bawah | `Button`/`ButtonLink` `varian="utama"`; sekunder `varian="garis"` (border navy) atau `"gelap"` |
| Teks isi, menu, footer | **Aleo** biasa, warna navy `#08266e` | default `body` |
| Judul kartu, angka, nomor, Report ID | **Aleo bold** (`font-bold`) — BUKAN Tilt Warp | `font-bold` |
| Label/tag, deskripsi kartu, teks kecil UI, teks grafik | **Barlow** (`font-ui`) — seperti kartu UKM di km.itb.ac.id | `font-ui` |
| Tilt Warp | **Hanya**: judul seksi besar (huruf campuran), pita judul, judul hero, judul band ("Pantauan"), tombol utama | `font-judul` |
| Band gelap | Biru laut `#08266e`, judul Tilt Warp putih kalimat biasa ("Profil") | `bg-km-navy` |
| Latar | Krem `#fff8e5` atau pastel blur + bintang blur, cincin konsentris, confetti cincin/busur | `<LatarPastel>`, `Cincin`, `Busur`, `BintangGaris`, `BintangKuning`, `BintangBlur`, `Konsentris` |
| Input | Sudut 6px (`rounded-md`), border navy tipis, fokus biru | `Input`, `Select`, `Textarea`, `PilihanKartu` |

Palet: `km-navy km-blue km-mint km-cream km-yellow km-lime km-pink km-purple km-red km-maroon km-orange km-green`.

## Tambahan dari referensi lain (tetap di atas dasar KM)

| Elemen | Sumber ide | Komponen |
|---|---|---|
| Report ID sebagai label nama buku tulis (No. Laporan / Kategori / Tanggal), tegak | styles.refero.design · Superr | `<LabelLaporan reportId baris>` (sukses lapor & lacak) |
| Judul seksi muncul halus saat di-scroll — **hanya judul**, bukan tiap kartu | km.itb.ac.id `.km-reveal` / motionsites · Kairo | otomatis di `SectionHeading` via `useReveal` |

Hindari dari galeri tersebut: 3D gelap, bola kaca, latar hitam neon — itu yang membuat desain terasa "AI".

## Takaran untuk situs pelaporan

- Ornamen (confetti, bintang, cincin) hanya di **Beranda, Tentang, header halaman, band biru**. Halaman kerja (Lapor, Jelajah, Isu, Lacak, Dashboard) memakai `LatarPastel ornamen={false}`.
- Maksimal ±3 ornamen per seksi; jangan menimpa teks.
- Footer ringkas: lambang, tautan satu baris, kontak, satu baris hak cipta — tanpa alamat panjang. Hero berisi judul + subjudul + 2 aksi (Buat laporan kuning `varian="kuning"`, Buat akun) + grafik gelembung suara di kanan (desktop saja).
- Report ID (`LabelLaporan`) tegak & rapi — ini bukti laporan, harus terlihat terpercaya.

## DILARANG (ciri "terlalu AI")

- Kartu putih membulat, kartu berbayangan, atau deretan kotak identik untuk konten yang sebenarnya daftar.
- Tombol pil (`rounded-full`) dan gradien merah→pink→ungu. `rounded-full` hanya untuk lingkaran sungguhan (gelembung peta, titik).
- Teks gradien (`teks-gradien`), blob blur di pojok (`Gumpalan` — sudah dihapus).
- Label kecil kapital ber-tracking di atas judul ("eyebrow"), panah `→` di ujung teks tombol.
- Judul panjang satu kalimat di `SectionHeading` — pindahkan kalimatnya ke `deskripsi`.
- Tilt Warp untuk angka, logo, judul kartu, atau teks kecil — pakai Aleo bold / Barlow.

Cek cepat: `grep -rnE "rounded-(2xl|3xl|kartu)|rounded-full|teks-gradien|gradien-cta|Gumpalan|tracking-\[0\.1|shadow-kartu|km-pastel|font-display" src/` → hanya lingkaran sungguhan yang boleh tersisa.

## Aset yang masih perlu dari tim

- `public/logo-km.png` — lambang resmi KM ITB untuk navbar & footer (sekarang wordmark sementara di `components/layout/Logo.tsx`).
- `public/landing/hero.webp` — foto kampus/kabinet untuk hero (slot sudah ada di `features/home/sections/Hero.tsx`).
