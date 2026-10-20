# Mockup Port Map (suarakm-web, git 40ac3d9)

Tracked files: 156 · ported: 54 · rebuilt: 36 · deferred: 2 · dropped: 64 · rows flagged UNCARRIED VALUE: 2 · new pages without a mockup counterpart: 29 (re-checked against the code on 16 October 2026, after workflow 8 built tuntutan, sign-up and the WhatsApp sender)

Outcomes: ported = content or look carried into a named new file. Rebuilt = role covered by new code built from PLAN.md or docs/architecture.md. Deferred = read back with `git show 40ac3d9:<path>` when the named feature is built. Dropped = not needed. New-location paths are relative to the repo root.

## Uncarried Value

1. "Gunakan lokasi saya" geolocation flow and its three failure messages (`src/features/lapor/components/steps/StepLokasi.tsx`): PLAN §5.9 keeps the feature, and it is not built.
2. ITB tenant contact `kabinet@km.itb.ac.id`, Instagram `km.itb`, "Kabinet KM ITB 2026/2027" (`src/constants/site.ts`, `src/components/layout/Footer.tsx`): not seeded (`db/seed/organizations.ts` holds a test contact address in `contact_email`), and there is no social-media field.

Already carried, not flagged: design tokens and the KM tenant theme (DESIGN.md, `db/seed/organizations.ts`), the CVD-checked chart palette (`app/features/data/chart-theme.ts`, DESIGN.md Charts), the category taxonomy (`shared/categories.ts`), contrast fixes (`app/styles.test.ts`, `shared/theme-contrast.ts`) and fonts (`app/fonts/`). Ten km.itb.ac.id files, `logo-km.png` among them, are carried as temporary copies in `public/km-itb/` for the KM ITB tenant only (DESIGN.md Temporary KM ITB Assets). The other km.itb.ac.id files are KM ITB property marked temporary in `SUMBER.txt` that no built page uses, so they are dropped rather than flagged.

## Map

| Mockup File | Outcome | New Location or Reason |
|---|---|---|
| `suarakm-web/.env.example` | dropped | Only `VITE_API_BASE_URL` and Esri tile vars for a Vite SPA; replaced by root `.env.example`. Esri default tiles without a key were flagged in PLAN §2 |
| `suarakm-web/.gitignore` | rebuilt | Root `.gitignore` |
| `suarakm-web/DESIGN.md` | ported | `DESIGN.md` (KM look kept as the "KM ITB Tenant Theme", colour/box/forbidden rules, chart palette); Title Case rule replaces "huruf kalimat biasa" (PLAN §8.3 E) |
| `suarakm-web/README.md` | dropped | Vite/npm/TanStack stack and folder guide superseded by PLAN.md §10 and docs/architecture.md; its "Yang belum" list is covered by PLAN |
| `suarakm-web/index.html` | rebuilt | `app/root.tsx` (`<html lang="id">`, viewport, favicon) with `app/components/layout/site-meta.tsx`, which sets the site-wide `<meta name="description">` (`site_description`) and `theme-color`. The theme colour is the tenant ink from `themeColor()` in `server/theme.server.ts`, not the mockup cream `#fff8e5` |
| `suarakm-web/package-lock.json` | dropped | npm lockfile; project uses Bun (`bun.lock`) |
| `suarakm-web/package.json` | rebuilt | Root `package.json` (Bun, React Router 8, Hono, Drizzle); Recharts/Leaflet/TanStack Query/RHF not carried |
| `suarakm-web/public/favicon.svg` | dropped | Mint-to-blue gradient tile replaced by the new Sadar Bersuara megaphone mark in `public/favicon.svg` |
| `suarakm-web/public/footer/arc-blue.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it, and the footer background is the `footerBg` gradient (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/footer/arc-pink.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it, and the footer background is the `footerBg` gradient (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/footer/arc-purple.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it, and the footer background is the `footerBg` gradient (DESIGN.md Temporary KM ITB Assets). Purple is not used in components (DESIGN.md) |
| `suarakm-web/public/footer/arc-red.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it, and the footer background is the `footerBg` gradient (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/footer/glow-behind-sosmed.webp` | dropped | km.itb.ac.id raster (temporary per SUMBER.txt); blurred glow, forbidden by DESIGN.md Ornaments; not referenced by mockup code |
| `suarakm-web/public/footer/glow-mint-right.webp` | dropped | km.itb.ac.id raster (temporary); blurred glow, not referenced by mockup code |
| `suarakm-web/public/footer/glow-yellow-left.webp` | dropped | km.itb.ac.id raster (temporary); blurred glow, not referenced by mockup code |
| `suarakm-web/public/footer/ring-green.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it, and the footer background is the `footerBg` gradient (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/footer/wave-left-a.webp` | dropped | km.itb.ac.id raster (temporary); full-bleed decoration, not referenced by mockup code |
| `suarakm-web/public/footer/wave-left-b.webp` | dropped | km.itb.ac.id raster (temporary); not referenced by mockup code |
| `suarakm-web/public/footer/wave-right.webp` | dropped | km.itb.ac.id raster (temporary); not referenced by mockup code |
| `suarakm-web/public/footer/wave-top-right.webp` | dropped | km.itb.ac.id raster (temporary); not referenced by mockup code |
| `suarakm-web/public/landing/SUMBER.txt` | ported | DESIGN.md "Temporary KM ITB Assets, Replace Before Release" quotes its note and records the source of every carried file |
| `suarakm-web/public/landing/arc-blue.svg` | dropped | km.itb.ac.id asset marked temporary, a duplicate of the footer arc, not referenced by mockup code. No built page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/landing/arc-lime.svg` | dropped | km.itb.ac.id asset marked temporary (actually a full ring), not referenced by mockup code. No built page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/landing/arc-red.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/landing/arc-yellow.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/landing/blob-union.svg` | dropped | km.itb.ac.id asset; blurred blob (`feGaussianBlur`), forbidden by DESIGN.md ("blurred blobs in corners") |
| `suarakm-web/public/landing/glow-star.webp` | dropped | km.itb.ac.id raster (temporary); blurred glow, not referenced by mockup code |
| `suarakm-web/public/landing/navlink-star.webp` | ported | `public/km-itb/navlink-star.webp` (the mockup file as is), the star on the active desktop menu item of the KM ITB tenant, picked by `brandImages` in `app/components/layout/brand-assets.ts` |
| `suarakm-web/public/landing/ribbon-blue-corner.webp` | dropped | km.itb.ac.id raster (temporary); full-bleed ribbon, dropped for paint cost (DESIGN.md Ornaments); not referenced by mockup code |
| `suarakm-web/public/landing/ribbon-blue.webp` | dropped | km.itb.ac.id raster (temporary); full-bleed ribbon, dropped for paint cost; not referenced by mockup code |
| `suarakm-web/public/landing/ribbon-yellow.webp` | dropped | km.itb.ac.id raster (temporary); full-bleed ribbon, dropped for paint cost; not referenced by mockup code |
| `suarakm-web/public/landing/ring-green.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/landing/ring-lime.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/landing/ring-yellow.svg` | dropped | km.itb.ac.id asset marked temporary and not referenced by mockup code. No built page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/landing/rings-45.svg` | ported | `public/km-itb/rings-45.svg` (`aria-hidden` added), drawn by `Rings` in `app/features/home/ornaments.tsx` in the hero graphic and behind the home lists, KM ITB tenant only. As an image file its blur is rasterised once |
| `suarakm-web/public/landing/sparkle-yellow-lg.webp` | dropped | km.itb.ac.id raster (temporary), not referenced by mockup code. No built page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/landing/star-pair-green.webp` | dropped | km.itb.ac.id raster (temporary); not referenced by mockup code |
| `suarakm-web/public/landing/star-white-pair.webp` | ported | `public/km-itb/star-white-pair-640.avif`, `star-white-pair-1200.avif` and WebP fallbacks (resized from 55 KB), drawn by `StarPair` in `app/features/home/ornaments.tsx` in the hero graphic and behind the home lists, KM ITB tenant only |
| `suarakm-web/public/logo-km.png` | ported | `public/km-itb/logo-km.webp` and `logo-km-168.webp` (resized from the 171,575-byte PNG), header and footer logo of the KM ITB tenant through `brandImages` in `app/components/layout/brand-assets.ts`. Temporary until KM ITB supplies the official SVG. Other tenants use `public/logo.svg` (DESIGN.md Logo) |
| `suarakm-web/public/tentang/SUMBER.txt` | dropped | No `tentang/` file is carried since 19 Oct 2026 (`/tentang` took the home look); DESIGN.md Temporary KM ITB Assets lists the files that were dropped |
| `suarakm-web/public/tentang/background-misi.webp` | dropped | km.itb.ac.id asset (temporary per tentang/SUMBER.txt), carried as `public/km-itb/about/` until it was dropped on 19 Oct 2026, when `/tentang` took the home look at the team's request; no page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/tentang/background-visi.webp` | dropped | km.itb.ac.id asset (temporary per tentang/SUMBER.txt), carried as `public/km-itb/about/` until it was dropped on 19 Oct 2026, when `/tentang` took the home look at the team's request; no page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/tentang/bg-element-2.webp` | dropped | km.itb.ac.id asset (temporary per tentang/SUMBER.txt), carried as `public/km-itb/about/` until it was dropped on 19 Oct 2026, when `/tentang` took the home look at the team's request; no page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/tentang/blend-group-12.webp` | dropped | km.itb.ac.id asset (temporary per tentang/SUMBER.txt), carried as `public/km-itb/about/` until it was dropped on 19 Oct 2026, when `/tentang` took the home look at the team's request; no page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/tentang/ellipse-49.svg` | dropped | km.itb.ac.id asset (temporary per tentang/SUMBER.txt), carried as `public/km-itb/about/` until it was dropped on 19 Oct 2026, when `/tentang` took the home look at the team's request; no page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/tentang/ellipse-53.svg` | dropped | km.itb.ac.id asset (temporary per tentang/SUMBER.txt), carried as `public/km-itb/about/` until it was dropped on 19 Oct 2026, when `/tentang` took the home look at the team's request; no page uses it (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/tentang/frame-penomoran-visi.webp` | dropped | km.itb.ac.id 64 px image (temporary) that the mockup used as a CSS mask, but it is opaque, so it masked nothing. The `/tentang` number square is plain `bg-brand` in `InfoCard` (DESIGN.md Temporary KM ITB Assets) |
| `suarakm-web/public/tentang/vector-61.webp` | dropped | 102 KB km.itb.ac.id kabinet raster (temporary per tentang/SUMBER.txt); not referenced by mockup code |
| `suarakm-web/src/app/layouts/AuthLayout.tsx` | ported | `app/components/layout/auth-card.tsx` (`AuthCard`, the mockup card for `/masuk` and `/masuk/dua-langkah` with a brand border and 6px top) and the logo-only `variant="auth"` header in `app/components/layout/header.tsx` |
| `suarakm-web/src/app/layouts/RootLayout.tsx` | rebuilt | `app/root.tsx` `Layout`, with the "Lewati ke konten" skip link (`app/components/layout/skip-link.tsx`) and the `<main id="konten">` target (WCAG 2.4.1) |
| `suarakm-web/src/app/providers.tsx` | dropped | TanStack Query client, replaced by SSR loaders. Its `ToastProvider` now lives in `app/components/ui/toast.tsx` and is mounted only by `app/routes/report/layout.tsx` (see Toast row) |
| `suarakm-web/src/app/router.tsx` | rebuilt | `app/routes.ts` (framework mode, Indonesian paths `/lapor/*`, `/isu`, `/isu/:code/laporkan`, `/isu/:code/berhenti`, `/aduan/:code`, `/data`, `/tentang`, `/privasi`, `/pedoman`, `/lacak`, `/masuk`, `/undangan/:id`, `/kelola/*`, `/admin`) |
| `suarakm-web/src/components/decor/Ornamen.tsx` | rebuilt | The `LatarPastel` background is the `pageBg` theme value in `db/seed/organizations.ts` (`bg-page`). Rings and the star pair are image ornaments in `app/features/home/ornaments.tsx`, behind the home and `/tentang` lists. The `/tentang` arcs and sparkles were dropped on 19 Oct 2026. The code shapes `Cincin`, `Busur`, `BintangGaris` and `BintangKuning` are not ported. `Pita`, `BintangBlur` and `Konsentris` are dropped for paint cost (DESIGN.md Ornaments) |
| `suarakm-web/src/components/layout/ChatBubble.tsx` | dropped | Floating mailto "Chat" button with heavy shadow; not in PLAN §6 IA; contact belongs to footer/About |
| `suarakm-web/src/components/layout/Footer.tsx` | ported | `app/components/layout/footer.tsx` (mockup footer on `bg-footer`, logo beside the name block, operator line, site and policy links, contact from `organizations.contact_email` through `server/site-identity.server.ts`). UNCARRIED VALUE: the ITB values `kabinet@km.itb.ac.id`, Instagram `km.itb` and "Kabinet KM ITB 2026/2027" are not seeded (the seed holds a test contact address), and neither the seed nor the Footer props have a social-media field |
| `suarakm-web/src/components/layout/Logo.tsx` | rebuilt | Logo link inside `app/components/layout/header.tsx` (`<img alt="">` + visible site name fixes label-content mismatch) |
| `suarakm-web/src/components/layout/Navbar.tsx` | ported | `app/components/layout/header.tsx` (mockup Navbar: `header-bg`, tilted `bg-highlight` active marker, the nav star on the KM ITB tenant, `<details>` mobile menu, sign-out form that clears the draft). The "Daftar" button is dropped |
| `suarakm-web/src/components/ui/Badge.tsx` | ported | `app/components/ui/badge.tsx` (mockup label shape and tones, `Nomor` as `StepNumber`) and `app/features/issues/issue-status.tsx` (`KategoriBadge` as `CategoryBadge`). `StatusBadge` and `UrgensiBadge` are replaced by two-axis status labels |
| `suarakm-web/src/components/ui/Button.tsx` | ported | `app/components/ui/button.tsx` (`Button`, `ButtonLink`, variants renamed `primary`, `highlight` (the mockup `kuning`), `secondary`, `quiet`, `dark`, `danger`, 44 px min height). The mockup button shadow is not carried |
| `suarakm-web/src/components/ui/Card.tsx` | ported | `app/components/ui/card.tsx` (`raised`, `pastel` as `brand-soft`, `inverse`) |
| `suarakm-web/src/components/ui/Container.tsx` | ported | `app/components/ui/container.tsx` (the mockup `mx-auto w-full px-4 sm:px-6` with a `width` option, `6xl` by default) |
| `suarakm-web/src/components/ui/Dialog.tsx` | ported | `app/components/ui/dialog.tsx` (native `<dialog>`, `showModal()`, `useId` label, mockup look). Backdrop click closes only with `closeOnBackdrop`, for dialogs without inputs |
| `suarakm-web/src/components/ui/Field.tsx` | ported | `app/components/ui/field.tsx` (label, hint, control, error order as GitHub Primer `FormControl`, linked by `aria-describedby`; the mockup's red `*` kept through `requiredMark` with native `required`, "(opsional)" on optional fields; `navy/15` border fixed to `border-line`) |
| `suarakm-web/src/components/ui/GridGaris.tsx` | dropped | Was `app/components/ui/line-grid.tsx` for the `/tentang` principles; removed on 19 Oct 2026 when `/tentang` took the home look, which sets the principles as text on hairlines in `app/routes/pages/about.tsx` |
| `suarakm-web/src/components/ui/Judul.tsx` | ported | `app/components/layout/page-header.tsx` `variant="band"` (accent strip H1) |
| `suarakm-web/src/components/ui/LabelLaporan.tsx` | ported | `app/features/report/report-label.tsx` (`ReportLabel` on the success page and the `/lacak` cards; no tilt, no link inside, PLAN §7) |
| `suarakm-web/src/components/ui/PageHeader.tsx` | ported | `app/components/layout/page-header.tsx` (`plain` variant fades `header-bg` into the page; eyebrow label dropped per DESIGN.md Forbidden) |
| `suarakm-web/src/components/ui/SectionHeading.tsx` | ported | `app/components/layout/section-heading.tsx` (`inverse` replaces `gelap`; reveal kept) |
| `suarakm-web/src/components/ui/Select.tsx` | rebuilt | `app/components/ui/select.tsx` native `<select>` (PLAN §9); custom listbox dropped (`aria-activedescendant` on `<button>`, PLAN §2) |
| `suarakm-web/src/components/ui/Skeleton.tsx` | ported | `app/components/ui/skeleton.tsx`, used only by the report step `HydrateFallback`. SSR pages show no skeletons |
| `suarakm-web/src/components/ui/Toast.tsx` | ported | `app/components/ui/toast.tsx` (`role="status"`, at most 3 visible, 5000 ms instead of the mockup's 3.5 s, paused on hover and focus), mounted by `app/routes/report/layout.tsx` for the copy button in `app/features/report/copy-code.tsx` |
| `suarakm-web/src/components/ui/index.ts` | dropped | Barrel file; DESIGN.md forbids barrels |
| `suarakm-web/src/constants/categories.ts` | ported | `shared/categories.ts` (stable IDs, three subgroups for programme, "Respons pemerintah" removed per PLAN §5.3). Labels, short labels (`category_*_short`) and one-line descriptions (`category_*_hint`) are in `messages/id.json`. Colour hexes are in `app/features/data/chart-theme.ts` and DESIGN.md Charts |
| `suarakm-web/src/constants/ranking.ts` | dropped | Issue leaderboard (most supported, lowest satisfaction, …) conflicts with PLAN §5.8 honest metrics; list sort covered by `issues_sort_*` messages |
| `suarakm-web/src/constants/regions.ts` | rebuilt | `db/schema/regions.ts`, `db/seed/regions.ts`, `app/features/report/regions.server.ts`, `app/routes/regions.ts` with Kemendagri codes; invented slugs (`jabar`) rejected in PLAN §2 |
| `suarakm-web/src/constants/site.ts` | rebuilt | `messages/id.json` (`home_title_line1`, `home_title_line2`, `home_tagline`; the lead `home_lead` was removed 19 Oct 2026), the menu in `app/components/layout/site-nav.ts` and tenant data in `db/seed/organizations.ts`. The names "SuaraKM" and "KM Lapor!" are dropped (PLAN §8.1). Contact data: see Footer row |
| `suarakm-web/src/constants/status.ts` | rebuilt | `shared/status.ts` (report, advocacy and government machines, and the tuntutan lifecycle plus the two subtuntutan axes, PLAN §5.4) and `app/features/issues/labels.ts`. The linear five-stage status is replaced by these axes (the issue page tracker is in the StatusTracker row), and the urgency badge colours are dropped |
| `suarakm-web/src/features/auth/sesi.ts` | dropped | Forgeable email-in-localStorage "session" (PLAN §2); replaced by Better Auth (`server/auth.server.ts`, `app/features/report/auth-client.ts`) |
| `suarakm-web/src/features/dashboard/CategoryBreakdown.tsx` | ported | `CategoryBreakdown` in `app/features/data/breakdowns.tsx` (server-rendered HTML and CSS bars in the CVD-checked category palette, table in `ChartCard`) |
| `suarakm-web/src/features/dashboard/ChartCard.tsx` | ported | `app/features/data/chart-card.tsx` (`ChartCard` with the `Tabel` toggle and a meta footer, `DataTable` as the row-header table). Without JS the card shows its table, as PLAN §5.8 asks |
| `suarakm-web/src/features/dashboard/DashboardSkeleton.tsx` | dropped | Client loading skeletons; `/data` is SSR |
| `suarakm-web/src/features/dashboard/IssueRanking.tsx` | rebuilt | `RankedIssues` in `app/features/data/issue-ranking.tsx`, section "Peringkat Isu" on `/data`. URL tabs (`?peringkat=laporan` or `terlama`, links with `aria-current`, no client JS) for "Laporan Terbanyak" and "Terlama Belum Selesai" (not confirmed resolved or closed, days since publish), read live by `listIssueRanking` in `app/features/issues/issues.server.ts`, five rows. Not carried: "Paling mendesak" and "Paling banyak terdampak" (private report fields), "Paling didukung" (PLAN §5.8 bans signature counts), "Kepuasan terendah" (Phase 2 ratings), and "Paling Diikuti" (a follower count reads like a signature count) |
| `suarakm-web/src/features/dashboard/ResponseRate.tsx` | ported | `ResolutionTile` in `app/features/data/summary.tsx` keeps the tile look (`bg-brand`, large number, track) but shows confirmed over checked resolution claims with the claimed total and its parts (PLAN §5.8). The PLAN §5.8 response rate can now be computed from `referrals` and `responses` (migration 0007) but is not built; it will take this tile's slot, never the mockup's unwindowed share |
| `suarakm-web/src/features/dashboard/SatisfactionPanel.tsx` | deferred | Fase 2 citizen rating (PLAN §5.7, architecture `features/issues/rating`): a 1–5 distribution with n, no mean, hidden below n = 10, on the issue page (PLAN §6.1 item 8). PLAN §5.8 lists no rating panel for `/data`. The trust claim "Satu akun satu suara, dilindungi …" is not ported. "Kabar terbaru" (headline list) stays out: its items are external press links, and no honest source fills it |
| `suarakm-web/src/features/dashboard/StatTile.tsx` | ported | `KeyNumbers` in `app/features/data/summary.tsx` (left brand rule, `dl` with `flex-col-reverse`, each number with its n or period) |
| `suarakm-web/src/features/dashboard/StatusFlow.tsx` | ported | `StatusFlow` in `app/features/data/breakdowns.tsx` (ordinal ramp for the five pipeline statuses of `shared/status.ts`, neutral grey for the exits) |
| `suarakm-web/src/features/dashboard/TrendChart.tsx` | rebuilt | `app/features/data/trend-chart.tsx`, `trend-lines.tsx`: server-rendered SVG with the mockup's end-point direct labels and a pointer tooltip; Recharts config not carried (DESIGN.md, trend chart row) |
| `suarakm-web/src/features/dashboard/TuntutanBoard.tsx` | ported | `app/features/demands/demand-digest.tsx` (`DemandDigest`, the compact register) in the `/data` section "Tuntutan Publik" (3 newest, "Lihat semua tuntutan"); the lead "Tuntutan disusun KM ITB dari isu yang sudah terverifikasi" is not used, because admins write tuntutan |
| `suarakm-web/src/features/dashboard/chartTheme.ts` | ported | `app/features/data/chart-theme.ts` (`CATEGORY_COLOR`, `TREND_COLOR`, `STATUS_RAMP`, social aid moved from purple to magenta for CVD) and DESIGN.md Charts |
| `suarakm-web/src/features/home/LatarKM.tsx` | ported | The background gradient is `homeListBg` in `db/seed/organizations.ts` (`bg-home-list` in `app/routes/home.tsx`), the star pair and rings come from `app/features/home/ornaments.tsx`, and `JudulKotak` is `BoxedHeading` in `app/components/layout/boxed-heading.tsx` |
| `suarakm-web/src/features/home/sections/BandKM.tsx` | dropped | Was `app/features/home/how-it-works.tsx` ("Cara Kerja", four numbered steps on `bg-band`), removed from home on 19 Oct 2026 at the team's request; the same big-number steps now sit on `/tentang` (`app/routes/pages/about.tsx`). The total counters were never ported: PLAN §6.1 "Tanpa angka total yang hanya untuk pamer" |
| `suarakm-web/src/features/home/sections/DaftarBeranda.tsx` | ported | `app/features/home/issue-showcase.tsx` (`IsuTerbaru` look with solid `ink`, `brand` and `pop-strong` cards for "Isu Terbaru", the newest published issues, as in the mockup; the earlier "Baru Ditanggapi Instansi" and "Selesai Terkonfirmasi" lists were dropped on 19 Oct 2026). The "Tuntutan Publik" poster becomes "Tuntutan yang Dikawal" before the issue lists (`app/features/home/demand-strip.tsx`, `DemandStrip`), shown only when a tuntutan is published |
| `suarakm-web/src/features/home/sections/HeroKM.tsx` | ported | `app/features/home/hero.tsx` (PLAN §8.2 copy and CTAs), `app/features/home/home-graphic.tsx` (`GrafikSuara`, KM ITB tenant only) and the `.hero-scroll` scroll-driven CSS in `app/styles.css`, which replaces the JS scroll handler. The "Buat akun" CTA is dropped |
| `suarakm-web/src/features/issues/components/DukungButton.tsx` | dropped | "Dukung" count is replaced by "Ikuti isu ini" (`app/features/issues/follow-card.tsx`), which shows no count (PLAN §5.8 does not show signature-style counts); optimistic local state flagged in PLAN §2 |
| `suarakm-web/src/features/issues/components/EvaluasiPublik.tsx` | deferred | Fase 2 rating (PLAN §5.7, architecture `features/issues/rating`): star radio group with sr-only labels and 1–5 word labels; fake protection claim not ported (DESIGN.md Trust Copy). The 1–5 word-label scale is reused, without stars, for the tuntutan importance rating (19 Oct 2026, `app/features/demands/rating-panel.tsx`, `/tuntutan/:code/nilai`), whose copy names only the checks the server runs |
| `suarakm-web/src/features/issues/components/IssueCard.tsx` | ported | `app/features/issues/issue-card.tsx` (mockup card look, category and two-axis status badges, excerpt, place, report count, update date and code, no support counts) |
| `suarakm-web/src/features/issues/components/IssueFilters.tsx` | ported | `app/features/issues/issue-filters.tsx` (GET form that works without JS, search with a visible label and hint, the mockup category chips as links, minimum 3 characters checked in `issues.server.ts`) |
| `suarakm-web/src/features/issues/components/StatusTracker.tsx` | ported | `app/features/issues/status-tracker.tsx` on the government-axis main path (PLAN §5.4), shown on the issue page |
| `suarakm-web/src/features/issues/components/Timeline.tsx` | ported | `app/features/issues/timeline.tsx` (newest first, dated entries), used on the issue page with "Isu diterbitkan" plus the stored `issue_events` (actor, note, "Status berubah: …"), and by `app/features/report/tracking-result.tsx` |
| `suarakm-web/src/features/issues/components/TuntutanIndikator.tsx` | ported | `app/features/demands/status-mark.tsx` (`ResponseMark`, `FulfilmentMark`, `ProgressSquares`): icon plus word, never colour alone; the mockup's red X is not ported (waiting and refused states are neutral, DESIGN.md Colour Rules) |
| `suarakm-web/src/features/issues/components/TuntutanLedger.tsx` | ported | `app/features/demands/demand-ledger.tsx` (`DemandLedger`: No., Tuntutan, Direspons, Pemenuhan, Dokumen) as a semantic `<ol>` with sighted column heads and per-cell labels on phones, not ARIA `role="table"` divs |
| `suarakm-web/src/features/issues/components/TuntutanList.tsx` | rebuilt | `app/routes/demands/list.tsx` (`/tuntutan`: `ExploreTabs`, `DemandScorecard`, `DemandFilters`, the ledger) |
| `suarakm-web/src/features/issues/useIssueFilter.ts` | rebuilt | `shared/canonical-query.ts` + `server/middleware/canonical-query.ts` (filters in URL, server-canonicalised) |
| `suarakm-web/src/features/lapor/components/Grup.tsx` | ported | `Fieldset`, `Radio`, `Checkbox` in `app/components/ui/field.tsx`, and `Catatan` as `Note` in `app/components/ui/note.tsx` |
| `suarakm-web/src/features/lapor/components/LaporForm.tsx` | rebuilt | `app/routes/report/*`, `app/features/report/step-page.tsx`, `validate.ts`, `review.tsx` (one route per step). After each client navigation `useRouteFocus` (`app/components/layout/route-focus.ts`, called in `app/root.tsx`) moves focus to the step's question H1 |
| `suarakm-web/src/features/lapor/components/Stepper.tsx` | ported | `app/features/report/step-list.tsx` (`StepList`, `StepProgress`), at the user's request (PLAN §7): `<ol>` with `aria-current="step"`, not clickable, bar `aria-hidden`; the mockup's `role="progressbar"` on `<ol>` (PLAN §2) not kept |
| `suarakm-web/src/features/lapor/components/SuksesLapor.tsx` | ported | `app/routes/report/success.tsx` (`ReportLabel`, `StepNumber` squares, copy button with a toast in `app/features/report/copy-code.tsx`). The "1–3 hari kerja" promise and the "tanpa perlu masuk" tracking claim are dropped (PLAN §7) |
| `suarakm-web/src/features/lapor/components/steps/StepBukti.tsx` | rebuilt | `app/features/report/steps/evidence.tsx`, `evidence-picker.tsx` (mockup dropzone with drag and drop; photos including HEIC, PDF and video), `video-meta.ts`, `evidence-upload.ts`. The source-link field is not in PLAN §7 step 5. The build error (`Film`/`FileText` unimported) is not carried |
| `suarakm-web/src/features/lapor/components/steps/StepDampak.tsx` | rebuilt | `app/features/report/steps/impact.tsx`; free-text "Dampak terhadap kehidupan" dropped (PLAN §7 step 4) |
| `suarakm-web/src/features/lapor/components/steps/StepDetail.tsx` | rebuilt | `app/features/report/steps/details.tsx` (one native date field with "Hari ini" and "Kemarin" chips from `app/components/ui/date-input.tsx`, hints not placeholders). The urgency hint is `details_urgency_hint` in `messages/id.json` |
| `suarakm-web/src/features/lapor/components/steps/StepIdentitas.tsx` | rebuilt | `app/features/report/steps/relation.tsx` (PLAN §7 step 1 wording and consent options) |
| `suarakm-web/src/features/lapor/components/steps/StepKirim.tsx` | rebuilt | `app/features/report/review.tsx` (check-answers with "Ubah" links, PLAN §7 consent set) |
| `suarakm-web/src/features/lapor/components/steps/StepKontak.tsx` | rebuilt | `app/features/report/steps/contact.tsx` (one yes or no question, phone and contact method shown on yes, the account email is used) |
| `suarakm-web/src/features/lapor/components/steps/StepLokasi.tsx` | rebuilt | `app/features/report/steps/location.tsx` (four native cascading selects). UNCARRIED VALUE: "Gunakan lokasi saya" (PLAN §5.9, not built) with its `getCurrentPosition` options and three failure messages (permission denied, unsupported, timeout) |
| `suarakm-web/src/features/lapor/draft.ts` | rebuilt | `app/features/report/draft.ts` (sessionStorage, no contact/coordinates/consent, cleared on sign-out, PLAN §7) |
| `suarakm-web/src/features/lapor/schema.ts` | rebuilt | `shared/report-schema.ts`, `shared/report-fields.ts` (Zod 4, stable IDs, PLAN §7 consent set) |
| `suarakm-web/src/features/lapor/types.ts` | rebuilt | Types inferred in `shared/report-schema.ts` |
| `suarakm-web/src/features/map/IssueMap.tsx` | rebuilt | The map role is covered by `app/features/data/region-map.tsx` and `region-map.server.ts`, a server SVG choropleth with fixed classes and a `<title>` per province (PLAN §5.9). Leaflet bubbles on keyless Esri tiles are not carried |
| `suarakm-web/src/features/map/MapExplorer.tsx` | ported | `MapExplorer` in `app/features/data/region-map.tsx` (mockup look on the ink band, Peta and Tabel switch, "Provinsi Teratas" aside with up to five, the note "Lokasi presisi pelapor tidak pernah ditampilkan" as `data_map_note`). The bubble legend is replaced by the choropleth legend |
| `suarakm-web/src/features/map/MapFilters.tsx` | ported | `MapFilters` in `app/features/data/region-map.tsx` (category segments as links, status select with a "Terapkan" button, works without JS) |
| `suarakm-web/src/features/map/ProvinceTable.tsx` | ported | `ProvinceTable` in `app/features/data/region-map.tsx` (caption and row headers through `app/components/ui/table.tsx`), the table view of the map |
| `suarakm-web/src/features/map/mapData.ts` | dropped | Proportional category×status estimate is guessed data (PLAN §5.8 honesty); Leaflet bounds unused by SVG map |
| `suarakm-web/src/features/tracking/components/TrackingResult.tsx` | ported | `app/features/report/tracking-result.tsx` (mockup cards on `pastel`: `ReportLabel`, report status badge, "Riwayat Laporan" from stored dates, behind sign-in, PLAN §6). No table and no Report ID lookup |
| `suarakm-web/src/hooks/useReveal.ts` | ported | `app/components/layout/use-reveal.ts` |
| `suarakm-web/src/hooks/useStagger.ts` | ported | `useStagger` in `app/components/layout/use-reveal.ts` and the `.stagger` CSS in `app/styles.css` (85 ms step, 520 ms, the mockup curve), on the home tuntutan and showcase lists, the `/tentang` steps and method cards, the `/data` key numbers and ranking, and the `/kelola/anggota` and `/admin` lists. The apex page uses the CSS-only `.view-rise-list` instead |
| `suarakm-web/src/lib/cn.ts` | ported | `app/components/ui/cn.ts` |
| `suarakm-web/src/lib/format.ts` | ported | `shared/format.ts` (`formatDate`, `formatDateTime`, `formatNumber`, `formatPercent`, `daysSince`, Asia/Jakarta). The compact number (`formatCompact`) and short month (`formatMonth`) formatters are in `app/features/data/format.ts` |
| `suarakm-web/src/main.tsx` | rebuilt | `app/entry.server.tsx` + React Router framework client entry |
| `suarakm-web/src/mocks/issues.ts` | dropped | Fictional issues for the SPA; tests use their own fixtures; PLAN forbids fake data in the product |
| `suarakm-web/src/mocks/provinsi.ts` | dropped | Fictional per-province counts with invented IDs; centroids derivable from boundary data (PLAN §5.9) |
| `suarakm-web/src/mocks/stats.ts` | dropped | Fictional national totals and headlines; PLAN §5.8 metrics differ |
| `suarakm-web/src/mocks/tracking.ts` | dropped | Fictional tracking records for the public-ID lookup PLAN §2 rejected |
| `suarakm-web/src/mocks/tuntutan.ts` | dropped | Fictional demands |
| `suarakm-web/src/pages/NotFoundPage.tsx` | ported | `ErrorPage` in `app/components/layout/error-page.tsx` (large status number, H1, one body line, actions) and the catch-all `app/routes/not-found.tsx`. The 404 text is in `messages/id.json` |
| `suarakm-web/src/pages/RouteError.tsx` | rebuilt | `ErrorBoundary` in `app/root.tsx`, which lazy-loads `RootError` from `app/components/layout/error-page.tsx` |
| `suarakm-web/src/pages/auth/MasukPage.tsx` | rebuilt | `app/routes/account/sign-in.tsx`, `app/features/report/sign-in.tsx` (`SignIn`: "Masuk atau Daftar", identifier-first Masuk, Daftar with name, email, WhatsApp number and the 18+ box, then a code by email or WhatsApp; 5-minute code); "mode demo" and "suaramu dihitung satu kali" claims dropped |
| `suarakm-web/src/pages/dashboard/DashboardPage.tsx` | rebuilt | `app/routes/data.tsx` (PLAN §5.8 sections: Angka Utama, the resolution tile and Kinerja Moderasi, Peta Isu, trend and category charts, Peringkat Isu, Tentang Data Ini), reading one stored snapshot through `app/features/data/dashboard.server.ts` plus the live ranking query |
| `suarakm-web/src/pages/home/HomePage.tsx` | ported | `app/routes/home.tsx` (the mockup composition: hero and "Tuntutan yang Dikawal" on `bg-band`, then "Isu Terbaru" on `bg-home-list`; Cara Kerja removed 19 Oct 2026). The band gradient is `bandBg` in `db/seed/organizations.ts` |
| `suarakm-web/src/pages/isu/IsuDetailPage.tsx` | rebuilt | `app/routes/issues/detail.tsx` (PLAN §6.1 order on a `bg-detail` hero: H1, two-axis status, metadata, referral and deadline lines, summary, OG image, agency responses, `StatusTracker`, `Timeline`, "Bukti", and the aside with "Mengalami Hal yang Sama?", the follow card and "Laporkan konten"). The support and share buttons, urgency badge, stats band and blurred ribbon are dropped |
| `suarakm-web/src/pages/jelajah/JelajahPage.tsx` | ported | `app/routes/issues/list.tsx` (`/isu`); its Isu and Tuntutan tabs are `ExploreTabs` (`app/features/demands/explore-tabs.tsx`) on `/isu` and `/tuntutan` |
| `suarakm-web/src/pages/lacak/LacakPage.tsx` | rebuilt | `app/routes/account/track.tsx` (session-based or a signed email link valid 30 days, PLAN §2 item 3), with "Bukti yang Belum Terkirim" (`app/features/report/pending-uploads.tsx`); public Report-ID lookup and "Hanya kamu yang bisa melihat" claim dropped |
| `suarakm-web/src/pages/lapor/LaporPage.tsx` | ported | `app/routes/report/layout.tsx` (mockup LaporPage look: `PageHeader`, `StepList`, white form card, intake pause), with the noscript notice in `app/features/report/step-page.tsx` |
| `suarakm-web/src/pages/tentang/TentangPage.tsx` | rebuilt | Content carried into `app/routes/pages/about.tsx`, `app/features/content/about-parts.tsx` and `about.server.ts` (PLAN §4 principles, the public and never-public lists as `about_public_*` and `about_never_*`, the CSTS credit from the org `settings.credit`). The mockup look (display letters, glow, bands, art) was replaced on 19 Oct 2026 by the home look at the team's request (DESIGN.md `about-parts.tsx` row). `/privasi` and `/pedoman` are `app/routes/pages/privacy.tsx` and `guidelines.tsx` |
| `suarakm-web/src/services/auth.service.ts` | dropped | TanStack/fetch OTP service; Better Auth client replaces it |
| `suarakm-web/src/services/http.ts` | dropped | JSON-only fetch wrapper that turned `File` into `{}` (PLAN §2); loaders/actions replace it |
| `suarakm-web/src/services/issues.service.ts` | dropped | TanStack Query service over mocks; replaced by `app/features/issues/issues.server.ts` |
| `suarakm-web/src/services/queries.ts` | dropped | TanStack Query keys; SSR loaders replace them |
| `suarakm-web/src/services/reports.service.ts` | dropped | 4-digit `KM-YYYY-XXXX` IDs (PLAN §2 collision risk) and JSON upload; replaced by `shared/report-id.ts`, `submit.server.ts`, `server/api/upload.server.ts` |
| `suarakm-web/src/services/stats.service.ts` | dropped | Mock stats service. `/data` reads stored snapshots through `app/features/data/dashboard.server.ts`, written by `worker/aggregates.ts` |
| `suarakm-web/src/styles/globals.css` | ported | `app/styles.css` (tokens remapped to `--theme-*`, self-hosted subset fonts, focus ring, selection, reduced motion, reveal, stagger and dialog motion, the hero scroll choreography). `.km-stagger` is now `.stagger`. Alias palettes are removed for contrast. Leaflet and Recharts overrides are dropped, because `/data` draws its map and trend chart as server SVG |
| `suarakm-web/src/types/domain.ts` | rebuilt | `shared/status.ts`, `shared/categories.ts`, `db/schema/*.ts` |
| `suarakm-web/src/types/report.ts` | rebuilt | `shared/report-schema.ts` inferred types |
| `suarakm-web/tsconfig.app.json` | dropped | Vite SPA tsconfig; root `tsconfig.json` |
| `suarakm-web/tsconfig.json` | dropped | Vite project references; root `tsconfig.json` |
| `suarakm-web/tsconfig.node.json` | dropped | Vite config tsconfig; root `tsconfig.json` |
| `suarakm-web/vite.config.ts` | dropped | Vite SPA config; root `vite.config.ts` + `react-router.config.ts` |

## New Pages and Parts Without a Mockup Counterpart

Built for PLAN Phase 1, in the mockup's look (DESIGN.md Components), with no file in `suarakm-web/` to port from.

| New Location | Route or Place | Notes |
|---|---|---|
| `app/features/issues/follow-card.tsx` | `/isu/:code` aside `#ikuti` | Follow and unfollow, after "Mengalami Hal yang Sama?" |
| `app/routes/issues/unfollow.tsx` | `/isu/:code/berhenti` | `AuthCard` confirm page from the signed email link |
| `app/features/issues/issue-record.tsx` | `/isu/:code` | Referral lines and agency responses |
| `app/features/issues/issue-evidence.tsx` | `/isu/:code#bukti` | Approved public evidence |
| `app/routes/issues/complaint.tsx`, `app/features/issues/complaint-panel.tsx` | `/isu/:code/laporkan` | Content complaint form |
| `app/routes/account/complaint.tsx` | `/aduan/:code` | Complaint receipt, decision and appeal |
| `app/components/layout/error-page.tsx` (code 410) | `/isu/:code` after removal | "Jelajahi Isu" plus "Pedoman konten" |
| `app/features/report/pending-uploads.tsx` | `/lacak` | Resend evidence that failed to upload |
| `app/routes/manage/home.tsx` | `/kelola` | Ringkasan: queue counts, "Perlu Tindakan", "Aktivitas Terbaru" |
| `app/routes/manage/queue.tsx` | `/kelola/antrean` | Queue with status tabs |
| `app/routes/manage/report.tsx` | `/kelola/laporan/:code` | Review, merge, forward, evidence cards |
| `app/routes/manage/close-account.tsx` | `/kelola/laporan/:code/tutup-akun` | Close a reporter's account (a minor, or an adult's deletion request) |
| `app/routes/manage/evidence-editor.tsx` | `/kelola/bukti/:id/sunting` | Censor editor and decision |
| `app/routes/manage/issues.tsx` | `/kelola/isu` | Issue list with filters |
| `app/routes/manage/issue.tsx` | `/kelola/isu/:code` | Publish, refer, escalate, response, status changes, timeline, issue edit, legal takedown |
| `app/routes/manage/complaints.tsx` | `/kelola/aduan` | Complaint queue (Baru, Banding, Selesai, Semua) |
| `app/routes/manage/complaint.tsx` | `/kelola/aduan/:code` | Reasoned decision and appeal |
| `app/routes/manage/audit.tsx` | `/kelola/audit` | Audit log with filters and paging |
| `app/routes/manage/members.tsx` | `/kelola/anggota` | Team and invitations (one admin role, no role choice) |
| `app/routes/manage/settings.tsx` | `/kelola/pengaturan` | Intake pause, operator identity, logo, theme |
| `app/routes/account/invitation.tsx` | `/undangan/:id` | Accept an admin invitation |
| `app/routes/account/step-up.tsx` | `/masuk/konfirmasi` | Fresh TOTP code before team, settings, organisation and WhatsApp-sender changes |
| `app/routes/pages/accessibility.tsx` | `/aksesibilitas` | Accessibility statement, also on the apex |
| `app/routes/demands/detail.tsx`, `brief.ts`, `og-image.ts` | `/tuntutan/:code`, its PDF download and OG image | Tuntutan page with subtuntutan, policy briefs, updates, Riwayat, related issues |
| `app/routes/demands/unfollow.tsx`, `complaint.tsx` | `/tuntutan/:code/berhenti`, `/tuntutan/:code/laporkan` | Same pages as the issue twins |
| `app/routes/manage/demands.tsx`, `demand-new.tsx`, `demand.tsx`, `demand-upload.ts` | `/kelola/tuntutan`, `/baru`, `/:code`, `/:code/unggah` | Admin tuntutan list, create, editor, policy brief upload |
| `app/routes/admin/whatsapp.tsx`, `app/features/whatsapp/sender-panel.tsx` | `/admin/whatsapp` | Link, watch and unlink the WhatsApp sender number |
| `app/routes/admin/campuses.tsx` | `/admin` | Superadmin: add an organisation |
| `app/components/layout/intake-banner.tsx` | every page while paused | Public intake-pause banner |

The apex national view (`app/features/data/national.tsx`, `/` on the apex host) also has no mockup page; it reuses the dashboard's key-number tile and table look.

