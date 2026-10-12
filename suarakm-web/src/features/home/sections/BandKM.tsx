import { useQuery } from "@tanstack/react-query";
import { q } from "@/services/queries";
import { formatAngka } from "@/lib/format";
import { Skeleton } from "@/components/ui";
import { useStagger } from "@/hooks/useStagger";

/** Bagian biru di bawah hero: judul "Pantauan", satu kalimat penjelasan, lalu angka — ditumpuk atas-bawah & rata tengah */
export function BandKM() {
  const { data: s } = useQuery(q.statistik());
  // Angka baru muncul (bergantian) saat di-scroll, tidak mengintip di layar pertama
  const daftar = useStagger<HTMLDListElement>(!!s);
  const angka = s
    ? [
        { nilai: formatAngka(s.totalLaporan), label: "laporan masuk" },
        {
          nilai: formatAngka(s.laporanTerverifikasi),
          label: "laporan terverifikasi",
        },
        { nilai: formatAngka(s.isuAktif), label: "isu aktif dipantau" },
        {
          nilai: formatAngka(s.telahDirespons),
          label: "isu sudah direspons pemerintah",
        },
      ]
    : null;

  return (
    <section aria-labelledby="pantauan-judul">
      <div className="mx-auto max-w-6xl px-6 pt-[clamp(1rem,4vw,3rem)] pb-[clamp(5rem,12vw,9rem)] text-center sm:px-10">
        <h2 id="pantauan-judul" className="font-judul text-[clamp(2.25rem,4.45vw,4rem)] leading-[1.2] text-white">
          Pantauan
        </h2>
        <p className="mx-auto mt-4 max-w-3xl leading-[1.7] text-white">
          Rekap laporan warga dan isu yang dipantau SuaraKM, termasuk yang sudah direspons pemerintah.
        </p>
        <dl ref={daftar} className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-4">
          {angka
            ? angka.map((a) => (
                <div key={a.label} className="flex flex-col-reverse items-center">
                  <dt className="mt-2 text-white/80">{a.label}</dt>
                  <dd className="text-[clamp(2.2rem,4vw,3.4rem)] leading-none font-bold text-white">
                    {a.nilai}
                  </dd>
                </div>
              ))
            : Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 bg-white/10" />
              ))}
        </dl>
      </div>
    </section>
  );
}
