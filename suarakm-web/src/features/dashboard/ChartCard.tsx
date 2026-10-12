import { useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";

interface Props {
  judul: string;
  deskripsi?: ReactNode;
  /** padanan tabel untuk aksesibilitas (wajib per pedoman dataviz) */
  tabel: ReactNode;
  children: ReactNode;
  legenda?: ReactNode;
  className?: string;
}

export function ChartCard({ judul, deskripsi, tabel, children, legenda, className }: Props) {
  const [lihatTabel, setLihatTabel] = useState(false);
  return (
    <Card className={cn("flex flex-col p-5 sm:p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-xl">{judul}</h3>
          {deskripsi && <p className="mt-0.5 text-sm text-tinta-600">{deskripsi}</p>}
        </div>
        <button
          type="button"
          onClick={() => setLihatTabel((v) => !v)}
          aria-pressed={lihatTabel}
          className="flex shrink-0 items-center gap-1.5 border-2 border-km-navy px-3 py-1.5 text-xs font-semibold text-km-navy hover:bg-km-cream aria-pressed:bg-km-navy aria-pressed:text-white"
        >
          {lihatTabel ? <BarChart3 className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
          {lihatTabel ? "Grafik" : "Tabel"}
        </button>
      </div>
      {legenda && !lihatTabel && <div className="mt-4">{legenda}</div>}
      <div className="mt-4 flex-1">{lihatTabel ? <div className="overflow-x-auto">{tabel}</div> : children}</div>
    </Card>
  );
}

export function TabelSederhana({ kolom, baris }: { kolom: string[]; baris: (string | number)[][] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-xs text-tinta-600">
          {kolom.map((k, i) => (
            <th key={k} scope="col" className={cn("border-b-2 border-km-navy px-2 py-2 font-semibold", i > 0 && "text-right")}>
              {k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {baris.map((b, i) => (
          <tr key={i} className="border-b border-tinta-900/6 last:border-0">
            {b.map((sel, j) =>
              j === 0 ? (
                <th key={j} scope="row" className="px-2 py-2 text-left font-semibold">
                  {sel}
                </th>
              ) : (
                <td key={j} className="px-2 py-2 text-right text-tinta-700">
                  {sel}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
