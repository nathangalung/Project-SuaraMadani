import { ExternalLink, ShieldCheck, Star } from "lucide-react";
import { Card } from "@/components/ui";
import { formatAngka, formatSkor, formatTanggal } from "@/lib/format";
import type { HeadlineBerita, StatistikNasional } from "@/types/domain";
import { RAMP_ORDINAL } from "./chartTheme";

interface Props {
  s: StatistikNasional;
  sebaran: { skor: number; jumlah: number }[];
  headline: HeadlineBerita[];
}

/** Panel kanan wireframe: "Kepuasan thd gov / headline news" (PDF §17) */
export function SatisfactionPanel({ s, sebaran, headline }: Props) {
  const total = sebaran.reduce((a, b) => a + b.jumlah, 0) || 1;
  const maks = Math.max(...sebaran.map((d) => d.jumlah), 1);
  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <h2 className="font-bold text-xl leading-snug">Kepuasan publik terhadap penanganan pemerintah</h2>
      <div className="mt-3 flex items-end gap-3">
        <p className="font-bold text-6xl leading-none text-km-navy">{formatSkor(s.kepuasanPublik)}</p>
        <p className="pb-1 text-tinta-600">
          / 5
          <span className="ml-2 inline-flex items-center gap-0.5 align-[-2px]" aria-hidden>
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className="size-4"
                fill={i <= Math.round(s.kepuasanPublik) ? "#ffe030" : "none"}
                stroke={i <= Math.round(s.kepuasanPublik) ? "#c9a800" : "#c4c4c4"}
              />
            ))}
          </span>
        </p>
      </div>
      <p className="mt-1 text-xs text-tinta-600">dari {formatAngka(s.jumlahPenilai)} penilaian warga</p>

      {/* Sebaran skor 1–5: kategori berurutan → ramp ordinal; nilai di ujung batang */}
      <figure className="mt-4">
        <figcaption className="sr-only">Sebaran penilaian kepuasan dari skor 1 sampai 5</figcaption>
        <ul className="flex flex-col gap-1.5">
          {[...sebaran].reverse().map((d) => {
            const persen = Math.round((d.jumlah / total) * 100);
            return (
              <li key={d.skor} className="grid grid-cols-[2.25rem_1fr_2.75rem] items-center gap-2 text-xs" title={`${formatAngka(d.jumlah)} penilaian`}>
                <span className="text-tinta-600">Skor {d.skor}</span>
                <span className="h-3 bg-km-navy/6">
                  <span
                    className="block h-full"
                    style={{ width: `${(d.jumlah / maks) * 100}%`, background: RAMP_ORDINAL[d.skor - 1] }}
                  />
                </span>
                <span className="text-right font-semibold tabular-nums">{persen}%</span>
              </li>
            );
          })}
        </ul>
      </figure>

      <p className="mt-4 flex gap-2 border-l-4 border-km-green bg-km-cream p-3 text-xs leading-relaxed text-tinta-700">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-hijau-600" aria-hidden />
        Penilaian ini cerminan sentimen publik, bukan ukuran objektif tunggal keberhasilan pemerintah. Satu akun satu suara,
        dilindungi pembatasan laju, anti-bot, dan log audit.
      </p>

      <div className="mt-5 border-t-2 border-km-navy pt-4">
        <h3 className="font-semibold">Kabar terbaru</h3>
        <ul className="mt-2 flex flex-col divide-y divide-km-navy/10">
          {headline.map((h) => (
            <li key={h.id} className="py-2.5">
              <a href={h.url} className="group block">
                <span className="text-sm leading-snug font-semibold group-hover:underline">{h.judul}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-tinta-600">
                  {h.sumber} · {formatTanggal(h.tanggal)}
                  <ExternalLink className="size-3" aria-hidden />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
