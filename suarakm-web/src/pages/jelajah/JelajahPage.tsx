import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { SearchX } from "lucide-react";
import { ButtonLink, Button, Container, PageHeader } from "@/components/ui";
import { LatarPastel } from "@/components/decor/Ornamen";
import { IssueCard, IssueCardSkeleton } from "@/features/issues/components/IssueCard";
import { IssueFilters } from "@/features/issues/components/IssueFilters";
import { TuntutanList } from "@/features/issues/components/TuntutanList";
import { useIssueFilter } from "@/features/issues/useIssueFilter";
import { RANKING } from "@/constants/ranking";
import { q } from "@/services/queries";
import { cn } from "@/lib/cn";

type Tab = "isu" | "tuntutan";

export default function JelajahPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "tuntutan" ? "tuntutan" : "isu";
  const { filter, ubah, reset, aktif } = useIssueFilter();
  const { data, isLoading } = useQuery({ ...q.issues(filter), placeholderData: (prev) => prev });

  const gantiTab = (t: Tab) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (t === "isu") n.delete("tab");
        else n.set("tab", t);
        return n;
      },
      { replace: true },
    );

  const ranking = RANKING.find((r) => r.id === filter.urutkan);

  return (
    <>
      <PageHeader
        judul="Jelajah Isu"
        label="Database isu & tuntutan publik"
        deskripsi="Semua isu yang sudah dilaporkan masyarakat, lengkap dengan status penanganan dan respons pemerintah. Identitas pelapor tidak pernah ditampilkan."
      >
        <div role="tablist" aria-label="Jenis data" className="mt-8 inline-flex border-2 border-km-blue bg-white">
          {(
            [
              ["isu", "Isu publik"],
              ["tuntutan", "Tuntutan"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => gantiTab(id)}
              className={cn(
                "px-6 py-2.5 font-bold text-base transition-colors",
                tab === id ? "bg-km-blue text-white" : "text-km-blue hover:bg-km-blue/10",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </PageHeader>

      <LatarPastel className="mt-10" ornamen={false}>
      <Container className="py-12 pb-24">
        {tab === "isu" ? (
          <div id="panel-isu" role="tabpanel" aria-labelledby="tab-isu">
            <IssueFilters filter={filter} ubah={ubah} />

            <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2" aria-live="polite">
              <p>
                {isLoading ? "Memuat isu…" : <><strong className="font-bold text-lg">{data?.length ?? 0}</strong> isu ditemukan</>}
                {ranking && <span className="text-tinta-500"> · {ranking.deskripsi}</span>}
              </p>
              {aktif && (
                <button type="button" onClick={reset} className="text-sm font-semibold text-km-blue underline-offset-2 hover:underline">
                  Hapus semua filter
                </button>
              )}
            </div>

            {isLoading ? (
              <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <IssueCardSkeleton key={i} />
                ))}
              </div>
            ) : data && data.length > 0 ? (
              <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {data.map((isu) => (
                  <li key={isu.id} className="flex">
                    <IssueCard issue={isu} className="w-full" />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-5 flex flex-col items-center border border-km-navy/12 bg-white px-6 py-16 text-center">
                <SearchX className="size-10 text-km-blue" aria-hidden />
                <p className="mt-4 text-lg font-semibold">Belum ada isu yang cocok.</p>
                <p className="mt-1 max-w-md text-tinta-600">
                  Hapus filter untuk melihat semua isu, atau laporkan persoalan baru kalau belum ada yang membahasnya.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Button varian="garis" onClick={reset}>
                    Hapus filter
                  </Button>
                  <ButtonLink to="/lapor">Buat laporan</ButtonLink>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div id="panel-tuntutan" role="tabpanel" aria-labelledby="tab-tuntutan">
            <p className="mx-auto mb-8 max-w-2xl text-center text-lg">
              Tuntutan disusun KM ITB dari isu yang sudah terverifikasi, lalu dikawal sampai ada respons. Setiap tuntutan punya
              policy brief yang bisa dibaca publik.
            </p>
            <TuntutanList />
          </div>
        )}
      </Container>
      </LatarPastel>
    </>
  );
}
