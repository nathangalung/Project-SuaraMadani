# SuaraKM — Frontend

Website & Central Dashboard KM ITB — *Public Accountability & Government Issue Tracking Platform*.
Frontend saja; semua data masih **data contoh (mock)** sampai backend siap.

## Menjalankan

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build produksi ke dist/
npm run preview    # menjalankan hasil build
```

Hubungkan ke backend dengan mengisi `VITE_API_BASE_URL` di `.env` (lihat `.env.example`).
Selama kosong, semua service otomatis memakai data dari `src/mocks/`.

## Tech stack

| Kebutuhan | Pilihan | Alasan |
|---|---|---|
| Build tool | **Vite** | Dev server instan, build cepat, tanpa server Node di produksi (cukup hosting statis). |
| UI | **React 19 + TypeScript** | Mayoritas halaman interaktif (form multi-langkah, peta, filter, chart); TS menjaga kontrak data dengan backend. |
| Routing | **React Router 7** | Route di-*lazy load* per halaman supaya peta & chart tidak memperberat beranda. |
| Styling | **Tailwind CSS v4** | Token desain (`@theme`) diambil langsung dari CSS km.itb.ac.id. |
| Data fetching | **TanStack Query** | Cache, loading/error state, dan optimistic update (dukung isu, rating). |
| Form | **React Hook Form + Zod** | Validasi per langkah; skema Zod nanti bisa dipakai ulang di backend. |
| Peta | **Leaflet + React Leaflet** | Bubble map per provinsi; basemap default Esri Light Gray, bisa diganti lewat `VITE_MAP_TILE_URL` (produksi: MapTiler/Stadia dengan API key). |
| Chart | **Recharts** | Chart deklaratif React untuk tren & distribusi. |
| Ikon | **lucide-react** | |
| Font | **Tilt Warp + Aleo** (self-host via Fontsource) | Sama dengan km.itb.ac.id. |

**Rekomendasi backend (nanti):** Node (Hono/NestJS) atau Laravel + PostgreSQL/PostGIS (agregasi wilayah & heatmap),
penyimpanan bukti di object storage (S3/R2), email OTP via Resend/SES, hosting frontend di Vercel/Netlify/Cloudflare Pages.

## Struktur folder

```
src/
├── app/                    # Kerangka aplikasi
│   ├── router.tsx          #   definisi route (lazy per halaman)
│   ├── providers.tsx       #   QueryClient, dsb.
│   └── layouts/            #   RootLayout (navbar+footer), AuthLayout
├── pages/                  # Komponen level-route (tipis, merangkai fitur)
│   ├── home/  lapor/  jelajah/  isu/  dashboard/  lacak/  tentang/  auth/
│   ├── NotFoundPage.tsx
│   └── RouteError.tsx
├── features/               # Modul per domain — logika + komponen spesifik
│   ├── home/sections/      #   seksi-seksi beranda
│   ├── lapor/              #   skema Zod + langkah-langkah formulir KM Lapor!
│   ├── issues/             #   IssueCard, filter, timeline, status tracker, evaluasi publik
│   ├── tracking/           #   hasil lacak laporan
│   ├── dashboard/          #   stat tile, papan tuntutan, kepuasan, chart, ranking isu
│   └── map/                #   peta isu nasional (Leaflet)
├── components/             # Komponen bersama, tanpa logika domain
│   ├── ui/                 #   Button, Card, Badge, Field, Judul, SectionHeading, Skeleton…
│   ├── layout/             #   Navbar, Footer, Logo, ChatBubble
│   └── decor/              #   ornamen (gumpalan, cincin, busur, kilau)
├── constants/              # Kategori & subkategori, status, urgensi, provinsi, teks situs
├── services/               # Satu-satunya pintu ke data: http.ts + *.service.ts + queries.ts
├── mocks/                  # Data contoh (hapus/abaikan saat backend siap)
├── types/                  # Tipe domain (PublicIssue, Tuntutan, Statistik, …)
├── lib/                    # Helper murni (cn, format angka/tanggal)
└── styles/globals.css      # Token desain Tailwind v4 + utilitas (judul, teks-gradien, sorot)
```

Aturan sederhana:
- `pages/` hanya merangkai; logika ada di `features/`.
- Komponen tidak pernah memanggil `fetch` langsung — selalu lewat `services/queries.ts`.
- Komponen di `components/` tidak boleh import dari `features/`.

## Halaman

| Route | Isi (sesuai dokumen konsep) |
|---|---|
| `/` | Hero, statistik utama, pratinjau dashboard, alur, kategori, isu terbaru |
| `/lapor` | Formulir KM Lapor! 7 langkah: identitas → lokasi → detail → dampak → bukti → kontak → persetujuan; Report ID `KM-2026-XXXX` |
| `/jelajah` | Database isu publik & tuntutan dengan filter yang tersimpan di URL |
| `/isu/:id` | Detail isu, status tracker, riwayat respons pemerintah, evaluasi publik (1–5), dukungan |
| `/dashboard` | Dashboard nasional: tingkat respons, tuntutan, kepuasan publik, peta isu, tren, ranking isu |
| `/lacak` | Lacak laporan dengan Report ID (coba `KM-2026-0412`) |
| `/tentang` | Tujuan, prinsip, metode verifikasi, privasi, moderasi, kredit |
| `/masuk` | Masuk dengan email + OTP (mode demo: kode 6 angka apa pun) |

## Desain

Mengikuti **km.itb.ac.id** (beranda & halaman kabinet): judul seksi putih berpendar dengan kotak warna miring,
pita biru selebar layar, kartu bersudut tajam bergradien pastel, nomor dalam kotak biru, label persegi warna solid,
tombol mint→biru ber-font Tilt Warp, band biru laut, latar pastel dengan bintang/cincin/confetti, footer pastel.
Aturan lengkap & daftar larangan ada di **[DESIGN.md](DESIGN.md)**.

## Yang belum (butuh backend / keputusan)

- Lambang resmi KM ITB (`public/logo-km.png`) dan foto hero (`public/landing/hero.webp`).
- Nama final (SuaraKM vs KM Lapor!) & tagline — saat ini: **SuaraKM**, fitur pelaporan **KM Lapor!**, tagline *Laporkan. Pantau. Suarakan.*
- Autentikasi sungguhan, sesi, dan proteksi voting (rate limit, CAPTCHA, audit log).
- Upload bukti ke storage, reverse-geocoding lokasi, data wilayah kab/kec/kel dari API.
- Panel admin/moderator untuk verifikasi & pengelompokan isu.
