import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/services/queries";
import { STATUS_MAP } from "@/constants/status";
import { formatAngka } from "@/lib/format";
import { Skeleton } from "@/components/ui";
import { useStagger } from "@/hooks/useStagger";
import { JudulKotak } from "../LatarKM";
import type { StatusIsu } from "@/types/domain";

/*
 * Bagian bawah beranda meniru km.itb.ac.id:
 *  - latar pastel dengan ornamen asli KM (bintang, gumpal, cincin, busur)
 *  - judul di tengah, Tilt Warp putih dalam kotak warna (sama seperti judul hero)
 *  - kartu isu = pola kartu tuntutan bijakmemantau.id (warna solid KM, judul putih, status berwarna, 3×2)
 *  - tuntutan = poster aksi: satu panel pink, daftar bernomor (lihat TuntutanPublik)
 */

/** Kartu isu ala "Pantau Tuntutan Masyarakat" bijakmemantau.id: warna solid KM (navy, biru, pink), tanpa ornamen.
 *  Urutan warna diatur supaya tidak ada dua warna sama bersebelahan di grid 3 kolom × 2 baris. */
const WARNA_KARTU = ["#08266e", "#176bff", "#f137a6", "#176bff", "#f137a6", "#08266e"];

/** Status di atas kartu berwarna: tiap tahap warna terang berbeda supaya mudah dibedakan & tetap terbaca */
const STATUS_KARTU: Record<StatusIsu, string> = {
  dilaporkan: "bg-km-cream text-km-navy",
  terverifikasi: "bg-km-mint text-km-navy",
  diproses: "bg-km-yellow text-km-navy",
  direspons: "bg-km-lime text-km-navy",
  selesai: "bg-[#bff3cf] text-km-forest",
};

export function IsuTerbaru() {
  const { data } = useQuery(q.issues({ urutkan: "terbaru" }));
  const daftar = useStagger<HTMLUListElement>(!!data);
  return (
    <section aria-labelledby="isu-terbaru-judul" className="px-6 py-14 sm:px-10 lg:py-20">
      <JudulKotak id="isu-terbaru-judul" warna="bg-km-blue">
        Isu Terbaru
      </JudulKotak>
      <ul ref={daftar} className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data
          ? data.slice(0, 6).map((i, n) => {
              return (
                <li key={i.id}>
                  <Link
                    to={`/isu/${i.id}`}
                    className="group flex h-full min-h-52 flex-col rounded-lg p-5 text-white"
                    style={{ background: WARNA_KARTU[n % WARNA_KARTU.length] }}
                  >
                    <span className={`self-start rounded px-2 py-0.5 font-ui text-sm font-bold ${STATUS_KARTU[i.status]}`}>
                      {STATUS_MAP[i.status].label}
                    </span>
                    <h3 className="mt-3 text-lg leading-snug font-bold">{i.judul}</h3>
                    <p className="mt-1 font-ui text-sm text-white/90">
                      {i.wilayah.provinsi} · {formatAngka(i.jumlahLaporan)} laporan
                    </p>
                    <span className="mt-auto self-start rounded-md border-2 border-white px-3.5 py-1 font-ui text-sm font-semibold transition-colors group-hover:bg-white group-hover:text-km-navy">
                      Lihat isu
                    </span>
                  </Link>
                </li>
              );
            })
          : Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-lg" />)}
      </ul>
      <p className="mt-10 text-center">
        <Link to="/jelajah" className="font-semibold text-km-blue underline underline-offset-4 hover:no-underline">
          Lihat semua isu
        </Link>
      </p>
    </section>
  );
}

/** Sudah/belum di kartu tuntutan berwarna: "sudah" lime menonjol, "belum" putih transparan */
function YaTidak({ ya, label }: { ya: boolean; label: string }) {
  return (
    <span className={`rounded px-2 py-0.5 font-ui text-sm font-bold ${ya ? "bg-km-lime text-km-navy" : "bg-white/20 text-white"}`}>
      {ya ? label : `Belum ${label.toLowerCase()}`}
    </span>
  );
}

/*
 * Tuntutan = poster aksi mahasiswa (rujukan: grafis "17+8 Tuntutan Rakyat", "7 Tuntutan #ReformasiDikorupsi"):
 * satu panel pink, judul besar, daftar bernomor, status sudah/belum di tiap baris. Bukan deretan kartu.
 */
/** Beranda hanya menampilkan 5 tuntutan; sisanya lewat "Lihat semua tuntutan" (tab Tuntutan di Jelajah) */
const MAKS_TUNTUTAN = 5;

export function TuntutanPublik() {
  const { data } = useQuery(q.tuntutan());
  const daftar = useStagger<HTMLOListElement>(!!data);
  return (
    <section aria-labelledby="tuntutan-judul" className="px-6 py-14 sm:px-10 lg:py-20">
      <div className="mx-auto max-w-4xl bg-km-pink px-6 py-10 text-white sm:px-12 sm:py-14">
        <h2 id="tuntutan-judul" className="font-judul text-[clamp(2.4rem,6vw,4.5rem)] leading-[0.95] uppercase">
          Tuntutan
          <br />
          Publik
        </h2>
        <p className="mt-4 font-ui text-base font-semibold text-white/90">Disusun KM ITB dari isu yang dilaporkan warga</p>
        <ol ref={daftar} className="mt-10 border-t-2 border-white">
          {data
            ? data.slice(0, MAKS_TUNTUTAN).map((t, i) => (
                <li key={t.id} className="grid grid-cols-[3rem_1fr] gap-x-4 border-b border-white/35 py-6 sm:grid-cols-[4.5rem_1fr]">
                  <span className="text-[clamp(2rem,4vw,3rem)] leading-none font-bold">{i + 1}</span>
                  <div>
                    <p className="text-xl leading-snug font-bold">{t.judul}</p>
                    <p className="mt-1 leading-relaxed text-white/90">{t.ringkasan}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <YaTidak ya={t.direspons} label="Direspons" />
                      <YaTidak ya={t.dipenuhi} label="Dipenuhi" />
                      <a href={t.policyBriefUrl} className="ml-2 font-ui text-sm font-semibold underline underline-offset-4 hover:no-underline">
                        Policy brief
                      </a>
                    </div>
                  </div>
                </li>
              ))
            : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-4 h-24 bg-white/15" />)}
        </ol>
        {data && data.length > MAKS_TUNTUTAN && (
          <Link
            to="/jelajah?tab=tuntutan"
            className="mt-8 inline-block rounded-md border-2 border-white px-4 py-1.5 font-ui font-semibold transition-colors hover:bg-white hover:text-km-pink"
          >
            Lihat semua tuntutan ({formatAngka(data.length)})
          </Link>
        )}
      </div>
    </section>
  );
}
