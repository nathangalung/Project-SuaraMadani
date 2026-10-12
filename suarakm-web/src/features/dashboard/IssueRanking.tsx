import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Card, KategoriBadge, Nomor, Skeleton, StatusBadge } from "@/components/ui";
import { RANKING } from "@/constants/ranking";
import { URGENSI_MAP } from "@/constants/status";
import { cn } from "@/lib/cn";
import { formatAngka, formatSkor, hariSejak } from "@/lib/format";
import { q } from "@/services/queries";
import type { IssueRankingKey, PublicIssue } from "@/types/domain";

function metrik(kunci: IssueRankingKey, i: PublicIssue): { nilai: string; satuan: string } {
  switch (kunci) {
    case "terbanyak":
      return { nilai: formatAngka(i.jumlahLaporan), satuan: "laporan" };
    case "terdesak":
      return { nilai: URGENSI_MAP[i.urgensi].label, satuan: "urgensi" };
    case "terdampak":
      return { nilai: formatAngka(i.estimasiTerdampak), satuan: "warga terdampak" };
    case "didukung":
      return { nilai: formatAngka(i.dukungan), satuan: "dukungan" };
    case "kepuasanTerendah":
      return { nilai: i.kepuasan !== null ? `${formatSkor(i.kepuasan)}/5` : "–", satuan: "kepuasan" };
    case "terlamaBelumSelesai":
      return { nilai: formatAngka(hariSejak(i.dibuat)), satuan: "hari belum selesai" };
    default:
      return { nilai: formatAngka(i.jumlahLaporan), satuan: "laporan" };
  }
}

/** Issue ranking (PDF §21) — tab dengan navigasi panah */
export function IssueRanking() {
  const [aktif, setAktif] = useState<IssueRankingKey>(RANKING[0].id);
  const dasarId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { data, isPending, isPlaceholderData } = useQuery({
    ...q.issues({ urutkan: aktif }),
    placeholderData: keepPreviousData,
  });
  const meta = RANKING.find((r) => r.id === aktif)!;

  const onKey = (e: KeyboardEvent, idx: number) => {
    let ke = idx;
    if (e.key === "ArrowRight") ke = (idx + 1) % RANKING.length;
    else if (e.key === "ArrowLeft") ke = (idx - 1 + RANKING.length) % RANKING.length;
    else if (e.key === "Home") ke = 0;
    else if (e.key === "End") ke = RANKING.length - 1;
    else return;
    e.preventDefault();
    setAktif(RANKING[ke].id);
    tabRefs.current[ke]?.focus();
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b-2 border-km-navy bg-km-cream">
        <div role="tablist" aria-label="Urutkan isu berdasarkan" className="flex overflow-x-auto">
          {RANKING.map((r, idx) => {
            const dipilih = r.id === aktif;
            return (
              <button
                key={r.id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                role="tab"
                id={`${dasarId}-tab-${r.id}`}
                aria-selected={dipilih}
                aria-controls={`${dasarId}-panel`}
                tabIndex={dipilih ? 0 : -1}
                onClick={() => setAktif(r.id)}
                onKeyDown={(e) => onKey(e, idx)}
                className={cn(
                  "shrink-0 px-4 py-3.5 text-sm whitespace-nowrap transition-colors",
                  dipilih ? "bg-km-blue font-semibold text-white" : "text-km-navy hover:bg-km-navy/5",
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${dasarId}-panel`}
        aria-labelledby={`${dasarId}-tab-${aktif}`}
        className={cn("p-4 transition-opacity sm:p-6", isPlaceholderData && "opacity-60")}
      >
        <p className="pb-3 text-sm text-tinta-700">{meta.deskripsi}</p>
        {isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <ol className="flex flex-col">
            {data.slice(0, 5).map((isu, i) => {
              const m = metrik(aktif, isu);
              return (
                <li key={isu.id} className="border-t border-km-navy/10 first:border-0">
                  <Link
                    to={`/isu/${isu.id}`}
                    className="group grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 py-3.5 hover:bg-km-cream"
                  >
                    <Nomor>{i + 1}</Nomor>
                    <span className="min-w-0">
                      <span className="block leading-snug font-semibold group-hover:underline">{isu.judul}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-tinta-600">
                        <KategoriBadge kategori={isu.kategori} />
                        <StatusBadge status={isu.status} />
                        <span>
                          {isu.wilayah.kabupaten ? `${isu.wilayah.kabupaten}, ` : ""}
                          {isu.wilayah.provinsi}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-right">
                      <span>
                        <span className="block font-bold text-lg tabular-nums">{m.nilai}</span>
                        <span className="block text-xs text-tinta-600">{m.satuan}</span>
                      </span>
                      <ChevronRight className="hidden size-4 text-tinta-400 sm:block" aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-6 text-sm text-tinta-600">Belum ada isu untuk peringkat ini.</p>
        )}
      </div>
    </Card>
  );
}
