import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAngka, formatBulan, formatRingkas } from "@/lib/format";
import type { TrenBulanan } from "@/types/domain";
import { ChartCard, TabelSederhana } from "./ChartCard";
import { TINTA, WARNA_TREN } from "./chartTheme";

const SERI = [
  { key: "masuk", label: "Laporan masuk", warna: WARNA_TREN.masuk },
  { key: "terverifikasi", label: "Terverifikasi", warna: WARNA_TREN.terverifikasi },
] as const;

interface TooltipIsi {
  active?: boolean;
  label?: string;
  payload?: { dataKey: string; value: number }[];
}

function IsiTooltip({ active, label, payload }: TooltipIsi) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white px-3 py-2 text-sm ring-1 ring-km-navy/15">
      <p className="mb-1 text-xs text-tinta-600">{label}</p>
      {SERI.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value;
        return (
          <p key={s.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3" style={{ background: s.warna }} aria-hidden />
            <strong className="font-semibold text-tinta-900 tabular-nums">{v !== undefined ? formatAngka(v) : "–"}</strong>
            <span className="text-tinta-600">{s.label}</span>
          </p>
        );
      })}
    </div>
  );
}

export function TrendChart({ data }: { data: TrenBulanan[] }) {
  const baris = data.map((d) => ({ ...d, label: formatBulan(d.bulan) }));
  const terakhir = baris.length - 1;

  return (
    <ChartCard
      judul="Tren laporan bulanan"
      deskripsi="Laporan masuk dibandingkan laporan yang lolos verifikasi. Oktober masih berjalan."
      legenda={
        <ul className="flex flex-wrap gap-4 text-sm text-tinta-700">
          {SERI.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="h-0.5 w-4" style={{ background: s.warna }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      }
      tabel={
        <TabelSederhana
          kolom={["Bulan", "Masuk", "Terverifikasi"]}
          baris={baris.map((d) => [d.label, formatAngka(d.masuk), formatAngka(d.terverifikasi)])}
        />
      }
    >
      <div className="h-full min-h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={baris} margin={{ top: 12, right: 52, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke={TINTA.grid} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: TINTA.sumbu }}
              tick={{ fill: TINTA.redup, fontSize: 12 }}
              dy={6}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: TINTA.redup, fontSize: 12 }}
              tickFormatter={(v: number) => formatRingkas(v)}
              width={48}
            />
            <Tooltip content={<IsiTooltip />} cursor={{ stroke: TINTA.sumbu, strokeWidth: 1 }} />
            {SERI.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.warna}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={(p: { cx?: number; cy?: number; index?: number }) =>
                  p.index === terakhir && p.cx !== undefined && p.cy !== undefined ? (
                    <circle key={`d-${s.key}`} cx={p.cx} cy={p.cy} r={4.5} fill={s.warna} stroke="#fff" strokeWidth={2} />
                  ) : (
                    <g key={`d-${s.key}-${p.index}`} />
                  )
                }
                activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: s.warna }}
                isAnimationActive={false}
              >
                {/* Label langsung hanya di titik akhir */}
                <LabelList
                  dataKey={s.key}
                  content={(props) => {
                    const p = props as { x?: number | string; y?: number | string; index?: number; value?: number | string };
                    return p.index === terakhir ? (
                      <text x={Number(p.x) + 9} y={Number(p.y) + 4} fontSize={12} fill={TINTA.primer} fontWeight={600}>
                        {formatRingkas(Number(p.value))}
                      </text>
                    ) : (
                      <g />
                    );
                  }}
                />
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
