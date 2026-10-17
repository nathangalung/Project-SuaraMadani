import { type PointerEvent, useState } from "react"
import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"
import type { TrendPoint } from "../../../shared/dashboard.ts"
import { formatNumber } from "../../../shared/format.ts"
import { CHART_INK, TREND_COLOR } from "./chart-theme"
import { formatCompact, formatMonth } from "./format"

type SeriesKey = keyof typeof TREND_COLOR
type Labels = readonly { key: SeriesKey; label: string }[]
type Point = readonly [number, number]

// Plot units, stretched to box
const SIZE = 1000

/** Zero-based whole ticks. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const nice = [1, 2, 2.5, 5, 10].find((f) => f * power >= raw) ?? 10
  const step = Math.max(1, Math.ceil(nice * power))
  const top = Math.ceil(max / step) * step
  return Array.from({ length: top / step + 1 }, (_, i) => i * step)
}

const round = (value: number) => Math.round(value * 10) / 10

function slope3(a: Point, b: Point, c: Point): number {
  const h0 = b[0] - a[0]
  const h1 = c[0] - b[0]
  const s0 = (b[1] - a[1]) / h0
  const s1 = (c[1] - b[1]) / h1
  const p = (s0 * h1 + s1 * h0) / (h0 + h1)
  const sign = (x: number) => (x < 0 ? -1 : 1)
  return (
    (sign(s0) + sign(s1)) *
      Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  )
}

function slope2(a: Point, b: Point, t: number): number {
  const h = b[0] - a[0]
  return h ? ((3 * (b[1] - a[1])) / h - t) / 2 : t
}

/** Fritsch-Carlson, as d3 monotoneX. */
export function monotonePath(points: readonly Point[]): string {
  const at = (p: Point) => `${round(p[0])},${round(p[1])}`
  if (points.length < 3) {
    return points.map((p, i) => `${i ? "L" : "M"}${at(p)}`).join("")
  }
  const last = points.length - 1
  const t = points.map((p, i) => {
    const prev = points[i - 1]
    const next = points[i + 1]
    return prev && next ? slope3(prev, p, next) : 0
  })
  const [p0, p1] = points as [Point, Point]
  t[0] = slope2(p0, p1, t[1] ?? 0)
  t[last] = slope2(
    points[last - 1] as Point,
    points[last] as Point,
    t[last - 1] ?? 0,
  )
  let d = `M${at(p0)}`
  for (let i = 0; i < last; i++) {
    const a = points[i] as Point
    const b = points[i + 1] as Point
    const dx = (b[0] - a[0]) / 3
    const c1: Point = [a[0] + dx, a[1] + dx * (t[i] ?? 0)]
    const c2: Point = [b[0] - dx, b[1] - dx * (t[i + 1] ?? 0)]
    d += `C${at(c1)} ${at(c2)} ${at(b)}`
  }
  return d
}

// Mockup end dot, ring white
function Dot({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
      style={{ left: `${x}%`, top: `${y}%`, background: color }}
    />
  )
}

// Server SVG, no chart library
export function TrendLines({
  trend,
  labels,
}: {
  trend: TrendPoint[]
  labels: Labels
}) {
  const [active, setActive] = useState<number | null>(null)
  const last = trend.length - 1
  const ticks = niceTicks(
    Math.max(0, ...trend.flatMap((point) => labels.map((s) => point[s.key]))),
  )
  const top = ticks.at(-1) ?? 1
  const x = (i: number) => (last > 0 ? (i / last) * 100 : 50)
  const y = (value: number) => 100 - (value / top) * 100
  const end = trend[last]
  const shown = active === null ? undefined : trend[active]
  const track = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    setActive(Math.min(last, Math.max(0, Math.round(ratio * last))))
  }
  return (
    <div
      className="grid h-full grid-cols-[2.5rem_1fr_3.25rem] grid-rows-[1fr_1.75rem] pt-3 font-ui text-xs"
      style={{ color: CHART_INK.muted }}
    >
      <div aria-hidden="true" className="relative col-start-1 row-start-1">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute right-2 -translate-y-1/2 tabular-nums"
            style={{ top: `${y(tick)}%` }}
          >
            {formatCompact(tick)}
          </span>
        ))}
      </div>
      <div
        role="img"
        aria-label={m.data_trend_caption()}
        className="relative col-start-2 row-start-1 touch-pan-y"
        onPointerMove={track}
        onPointerDown={track}
        onPointerLeave={(event) => {
          // Touch lift keeps the tooltip
          if (event.pointerType !== "touch") setActive(null)
        }}
      >
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {ticks.map((tick, i) => (
            <line
              key={tick}
              x1={0}
              x2={SIZE}
              y1={(y(tick) / 100) * SIZE}
              y2={(y(tick) / 100) * SIZE}
              stroke={i === 0 ? CHART_INK.axis : CHART_INK.grid}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {shown && active !== null && (
            <line
              x1={(x(active) / 100) * SIZE}
              x2={(x(active) / 100) * SIZE}
              y1={0}
              y2={SIZE}
              stroke={CHART_INK.axis}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {labels.map((s) => (
            <path
              key={s.key}
              d={monotonePath(
                trend.map((point, i) => [
                  (x(i) / 100) * SIZE,
                  (y(point[s.key]) / 100) * SIZE,
                ]),
              )}
              fill="none"
              stroke={TREND_COLOR[s.key]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {end &&
          labels.map((s) => (
            <span key={s.key}>
              <Dot x={x(last)} y={y(end[s.key])} color={TREND_COLOR[s.key]} />
              {/* Direct label, last point */}
              <span
                className="absolute translate-x-2.5 -translate-y-1/2 font-semibold tabular-nums"
                style={{
                  left: `${x(last)}%`,
                  top: `${y(end[s.key])}%`,
                  color: CHART_INK.primary,
                }}
              >
                {formatNumber(end[s.key])}
              </span>
            </span>
          ))}
        {shown && active !== null && (
          <>
            {labels.map((s) => (
              <Dot
                key={s.key}
                x={x(active)}
                y={y(shown[s.key])}
                color={TREND_COLOR[s.key]}
              />
            ))}
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute top-0 z-10 whitespace-nowrap bg-surface-raised px-3 py-2 text-ink text-sm ring-1 ring-ink/15",
                x(active) > 50 ? "-translate-x-full -ml-3" : "ml-3",
              )}
              style={{ left: `${x(active)}%` }}
            >
              <p className="mb-1 text-ink-muted text-xs">
                {formatMonth(shown.month, "long")}
              </p>
              {labels.map((s) => (
                <p key={s.key} className="flex items-center gap-2">
                  <span
                    className="h-0.5 w-3"
                    style={{ background: TREND_COLOR[s.key] }}
                  />
                  <strong className="font-semibold tabular-nums">
                    {formatNumber(shown[s.key])}
                  </strong>
                  <span className="text-ink-muted">{s.label}</span>
                </p>
              ))}
            </div>
          </>
        )}
      </div>
      <div aria-hidden="true" className="relative col-start-2 row-start-2">
        {trend.map((point, i) => (
          <span
            key={point.month}
            className={cn(
              "absolute top-1.5 -translate-x-1/2",
              // Phones: every other month
              (last - i) % 2 === 1 && "max-sm:hidden",
            )}
            style={{ left: `${x(i)}%` }}
          >
            {formatMonth(point.month, "short")}
          </span>
        ))}
      </div>
    </div>
  )
}
