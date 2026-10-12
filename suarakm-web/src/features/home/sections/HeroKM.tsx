import { useEffect, useId, useRef } from "react";
import { SITE } from "@/constants/site";
import { ButtonLink } from "@/components/ui";
import { useSesi } from "@/features/auth/sesi";

/**
 * Hero beranda: latar gradien KM, judul Tilt Warp putih di kotak pink.
 * Kanan: gelembung suara biru bertanda centang (suara → tercatat → terpantau) dengan ornamen KM.
 * Tombol utama kuning KM datar bergaris navy, berpasangan dengan tombol garis navy.
 *
 * Di layar lebar hero ditahan (sticky) selama sebagian scroll: gelembung bergerak ke tengah layar sambil
 * membesar dan teks memudar, lalu gelembung turun keluar layar sementara band angka naik (lihat useAnimasiHero).
 */
export function HeroKM() {
  const { seksi, panggung, latar, teks, grafik } = useAnimasiHero();
  const sesi = useSesi();
  return (
    <section
      ref={seksi}
      aria-labelledby="hero-judul"
      className="relative isolate w-full lg:motion-safe:-mb-[28vh] lg:motion-safe:h-[calc(100svh_-_6rem_+_110vh)]"
    >
      <div ref={panggung} className="relative overflow-hidden lg:motion-safe:sticky lg:motion-safe:top-24">
        <div ref={latar} className="absolute inset-0 -z-10 [mask-image:linear-gradient(180deg,#000_50%,rgba(0,0,0,0.6)_75%,transparent_98%)]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#f3f6cf_0%,#dff3e3_30%,#b9daf3_62%,#5f95ea_100%)]" />
        </div>

        <div className="mx-auto grid min-h-[calc(100svh-5rem)] max-w-7xl lg:min-h-[calc(100svh-6rem)] items-center gap-6 px-5 pt-10 pb-20 sm:px-8 lg:grid-cols-[1.35fr_1fr] lg:pb-28">
          <div ref={teks} className="relative z-10">
            <h1
              id="hero-judul"
              className="flex flex-col items-start font-judul text-[clamp(1.9rem,4.3vw,3.9rem)] leading-[1.14] text-white"
            >
              <span className="bg-km-pink px-[0.2em] pb-[0.06em] sm:whitespace-nowrap">Suara kamu,</span>
              <span className="bg-km-pink px-[0.2em] pb-[0.08em] sm:whitespace-nowrap">tercatat &amp; terpantau.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[clamp(1.1rem,1.9vw,1.45rem)] leading-snug font-medium text-km-navy">{SITE.subheadline}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <ButtonLink to="/lapor" varian="kuning" ukuran="lg">
                Buat laporan
              </ButtonLink>
              {!sesi && (
                <ButtonLink to="/masuk?mode=daftar" varian="garis" ukuran="lg">
                  Buat akun
                </ButtonLink>
              )}
            </div>
          </div>

          <div className="hidden w-full max-w-[30rem] justify-self-end lg:block">
            <div ref={grafik} className="will-change-transform">
              <GrafikSuara />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const jepit = (x: number) => Math.min(1, Math.max(0, x));
const halus = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Animasi scroll hero (hanya ≥lg & tanpa reduced-motion). Progres 0–1 = seberapa jauh seksi yang tinggi itu
 * sudah dilewati selama panggungnya sticky:
 * 0–0,45 gelembung ke tengah & membesar, teks memudar; 0,45–0,55 diam di tengah; 0,55–0,8 turun keluar layar
 * sementara latar terang memudar ke biru; setelahnya band angka (ditarik naik lewat -mb) masuk dari bawah.
 */
function useAnimasiHero() {
  const seksi = useRef<HTMLElement>(null);
  const panggung = useRef<HTMLDivElement>(null);
  const latar = useRef<HTMLDivElement>(null);
  const teks = useRef<HTMLDivElement>(null);
  const grafik = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem) and (prefers-reduced-motion: no-preference)");
    let raf = 0;

    const bersihkan = () => {
      for (const el of [latar.current, teks.current, grafik.current]) if (el) el.style.transform = el.style.opacity = "";
    };

    const gambar = () => {
      raf = 0;
      const s = seksi.current, p = panggung.current, l = latar.current, t = teks.current, g = grafik.current;
      if (!s || !p || !l || !t || !g) return;
      if (!mq.matches) return bersihkan();

      const rs = s.getBoundingClientRect();
      const rp = p.getBoundingClientRect();
      const jarak = rs.height - rp.height;
      const maju = jarak > 0 ? jepit(-rs.top / jarak) : 0;

      // posisi asli grafik (induknya tidak ditransformasi) → selisih ke tengah panggung
      const ri = g.parentElement!.getBoundingClientRect();
      const dx = rp.left + rp.width / 2 - (ri.left + ri.width / 2);
      const dy = rp.top + rp.height / 2 - (ri.top + ri.height / 2);

      const a = halus(jepit(maju / 0.45));
      const b = halus(jepit((maju - 0.55) / 0.25));
      g.style.transform = `translate3d(${dx * a}px, ${dy * a + b * rp.height * 0.95}px, 0) scale(${lerp(1, 1.45, a) - 0.25 * b})`;
      g.style.opacity = String(1 - jepit((maju - 0.65) / 0.15));

      l.style.opacity = String(1 - b); // latar terang → biru, agar angka putih yang naik tetap terbaca
      t.style.opacity = String(1 - jepit(maju / 0.3));
      t.style.transform = `translate3d(0, ${-40 * jepit(maju / 0.3)}px, 0)`;
    };

    const minta = () => {
      if (!raf) raf = requestAnimationFrame(gambar);
    };
    gambar();
    window.addEventListener("scroll", minta, { passive: true });
    window.addEventListener("resize", minta);
    mq.addEventListener("change", minta);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", minta);
      window.removeEventListener("resize", minta);
      mq.removeEventListener("change", minta);
      bersihkan();
    };
  }, []);

  return { seksi, panggung, latar, teks, grafik };
}

/** Gelembung suara + ornamen KM (cincin, bintang). Dekoratif saja; disembunyikan di layar kecil. */
function GrafikSuara() {
  const id = useId();
  return (
    <div aria-hidden className="relative aspect-square w-full">
      <img src="/landing/rings-45.svg" alt="" className="absolute -inset-[8%] h-[116%] w-[116%] max-w-none" />
      <img src="/landing/star-white-pair.webp" alt="" className="absolute -top-[6%] left-0 w-[34%] max-w-none" />

      <svg
        viewBox="0 0 400 360"
        className="absolute top-[16%] left-[8%] w-[82%] -rotate-6 overflow-visible drop-shadow-[0_18px_22px_rgb(8_38_110/0.28)]"
      >
        <defs>
          <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3f8ef7" />
            <stop offset="1" stopColor="#176bff" />
          </linearGradient>
        </defs>
        {/* gelembung suara */}
        <path
          d="M74 36 H306 A44 44 0 0 1 350 80 V214 A44 44 0 0 1 306 258 H156 L88 322 L104 258 H74 A44 44 0 0 1 30 214 V80 A44 44 0 0 1 74 36 Z"
          fill={`url(#${id}b)`}
          stroke="#fff"
          strokeWidth="8"
          strokeLinejoin="round"
        />
        {/* baris laporan yang tercatat */}
        <g fill="#fff">
          <rect x="78" y="88" width="196" height="20" rx="10" />
          <rect x="78" y="130" width="228" height="20" rx="10" opacity="0.8" />
          <rect x="78" y="172" width="150" height="20" rx="10" opacity="0.6" />
        </g>
        {/* lencana centang: terpantau */}
        <circle cx="336" cy="252" r="54" fill="#ffe030" stroke="#fff" strokeWidth="8" />
        <path d="M310 252 L330 272 L364 234" fill="none" stroke="#08266e" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
