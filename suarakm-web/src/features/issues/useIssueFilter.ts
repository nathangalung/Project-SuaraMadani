import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { IssueFilter, IssueRankingKey, KategoriId, StatusIsu } from "@/types/domain";

/** Filter isu yang disinkronkan ke URL (?q=&kategori=&status=&provinsi=&urut=) agar bisa dibagikan */
export function useIssueFilter() {
  const [params, setParams] = useSearchParams();

  const filter: IssueFilter = useMemo(
    () => ({
      q: params.get("q") ?? "",
      kategori: (params.get("kategori") as KategoriId | null) ?? "semua",
      status: (params.get("status") as StatusIsu | null) ?? "semua",
      provinsiId: params.get("provinsi") ?? "semua",
      urutkan: (params.get("urut") as IssueRankingKey | null) ?? "terbaru",
    }),
    [params],
  );

  const ubah = useCallback(
    (patch: Partial<IssueFilter>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const kunci: Record<keyof IssueFilter, string> = {
            q: "q",
            kategori: "kategori",
            status: "status",
            provinsiId: "provinsi",
            urutkan: "urut",
          };
          for (const [k, v] of Object.entries(patch) as [keyof IssueFilter, string | undefined][]) {
            const bawaan = k === "urutkan" ? "terbaru" : "semua";
            if (!v || v === bawaan) next.delete(kunci[k]);
            else next.set(kunci[k], v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const reset = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams();
        const tab = prev.get("tab");
        if (tab) next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const aktif =
    !!filter.q || filter.kategori !== "semua" || filter.status !== "semua" || filter.provinsiId !== "semua";

  return { filter, ubah, reset, aktif };
}
