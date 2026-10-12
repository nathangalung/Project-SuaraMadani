import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import { KATEGORI } from "@/constants/categories";
import { STATUS_MAP } from "@/constants/status";
import { cn } from "@/lib/cn";
import { formatAngka } from "@/lib/format";
import type { ProvinsiAgregat } from "@/types/domain";
import { WARNA_KATEGORI, WARNA_SEMUA } from "@/features/dashboard/chartTheme";
import { BATAS_INDONESIA, FILTER_AWAL, nilaiProvinsi, type MapFilter } from "./mapData";

export interface IssueMapProps {
  /** Agregat per provinsi (q.provinsi()) */
  data: ProvinsiAgregat[];
  /** Filter kategori/status/wilayah; default: semua & nasional */
  filter?: MapFilter;
  /** Tinggi peta (px atau string CSS). Default 520px; bisa juga lewat className (mis. "h-[360px]") */
  height?: number | string;
  /** Versi ringkas untuk beranda: gelembung lebih kecil, tanpa kontrol zoom, peta tidak bisa digeser */
  compact?: boolean;
  /** Dipanggil saat gelembung provinsi diklik */
  onSelectProvinsi?: (id: string) => void;
  className?: string;
}

/**
 * Basemap abu-abu terang tanpa label supaya gelembung menonjol.
 * Untuk produksi, ganti lewat env (mis. MapTiler/Stadia/CARTO dengan API key):
 *   VITE_MAP_TILE_URL & VITE_MAP_TILE_ATTRIBUTION
 */
const TILE_URL =
  (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ??
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const ATRIBUSI =
  (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined) ?? "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";

function PengaturKamera({ wilayah, data }: { wilayah: string; data: ProvinsiAgregat[] }) {
  const map = useMap();
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = data.find((p) => p.id === wilayah);
    if (target) {
      map.flyTo([target.lat, target.lng], 6, { duration: reduce ? 0 : 0.9 });
    } else {
      map.flyToBounds(BATAS_INDONESIA, { duration: reduce ? 0 : 0.9, padding: [12, 12] });
    }
  }, [wilayah, data, map]);
  return null;
}

/** Ukur ulang saat kontainer berubah ukuran (mis. layout responsif) */
function PengamatUkuran() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function IssueMap({ data, filter = FILTER_AWAL, height, compact = false, onSelectProvinsi, className }: IssueMapProps) {
  // Gelembung terbesar mengikuti lebar peta supaya tidak menutupi pulau di layar kecil
  const wadah = useRef<HTMLDivElement>(null);
  const [lebar, setLebar] = useState(800);
  useEffect(() => {
    const el = wadah.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLebar(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const titik = useMemo(() => {
    const isi = data.map((p) => ({ p, ...nilaiProvinsi(p, filter) }));
    const maks = Math.max(1, ...isi.map((t) => t.nilai));
    const rMaks = Math.max(12, Math.min(compact ? 24 : 34, lebar / 24));
    return isi
      .map((t) => ({ ...t, r: t.nilai === 0 ? 0 : 4 + (rMaks - 4) * Math.sqrt(t.nilai / maks) }))
      // gelembung besar digambar dulu supaya yang kecil tetap terlihat di atasnya
      .sort((a, b) => b.r - a.r);
  }, [data, filter, compact, lebar]);

  const warna = filter.kategori === "semua" ? WARNA_SEMUA : WARNA_KATEGORI[filter.kategori];
  const adaPilihan = filter.wilayah !== "nasional";

  return (
    <div ref={wadah} className={cn("relative isolate h-[520px] overflow-hidden", className)} style={height !== undefined ? { height } : undefined}>
      <MapContainer
        bounds={BATAS_INDONESIA}
        boundsOptions={{ padding: [12, 12] }}
        scrollWheelZoom={false}
        zoomControl={!compact}
        dragging={!compact}
        doubleClickZoom={!compact}
        touchZoom={!compact}
        keyboard={!compact}
        minZoom={3}
        maxZoom={9}
        className="size-full"
        attributionControl
      >
        <TileLayer url={TILE_URL} attribution={ATRIBUSI} maxNativeZoom={16} />
        <PengaturKamera wilayah={filter.wilayah} data={data} />
        <PengamatUkuran />
        {titik.map(({ p, nilai, satuan, perkiraan, r }) => {
          if (r === 0) return null;
          const dipilih = p.id === filter.wilayah;
          const redup = adaPilihan && !dipilih;
          return (
            <CircleMarker
              key={`${p.id}-${filter.kategori}-${filter.status}-${dipilih}-${Math.round(r)}`}
              center={[p.lat, p.lng]}
              radius={r}
              pathOptions={{
                color: dipilih ? "#08266e" : "#ffffff",
                weight: dipilih ? 3 : 2,
                fillColor: warna,
                fillOpacity: redup ? 0.25 : 0.72,
                opacity: redup ? 0.5 : 1,
              }}
              eventHandlers={onSelectProvinsi ? { click: () => onSelectProvinsi(p.id) } : undefined}
            >
              <Tooltip className="tooltip-isu" direction="top" offset={[0, -r]} opacity={1}>
                <div className="min-w-44">
                  <p className="text-base font-semibold">
                    {formatAngka(nilai)} {satuan}
                    {perkiraan && <span className="ml-1 text-xs font-normal text-tinta-600">(perkiraan)</span>}
                  </p>
                  <p className="text-sm text-tinta-600">{p.nama}</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-tinta-700">
                    <dt>Total laporan</dt>
                    <dd className="text-right tabular-nums">{formatAngka(p.jumlahLaporan)}</dd>
                    <dt>Isu aktif</dt>
                    <dd className="text-right tabular-nums">{formatAngka(p.isuAktif)}</dd>
                    {KATEGORI.map((k) => (
                      <FragmenBaris key={k.id} warna={WARNA_KATEGORI[k.id]} label={k.labelPendek} nilai={p.perKategori[k.id]} />
                    ))}
                    {filter.status !== "semua" && (
                      <>
                        <dt>{STATUS_MAP[filter.status].label}</dt>
                        <dd className="text-right tabular-nums">{formatAngka(p.perStatus[filter.status])} isu</dd>
                      </>
                    )}
                  </dl>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

function FragmenBaris({ warna, label, nilai }: { warna: string; label: string; nilai: number }) {
  return (
    <>
      <dt className="flex items-center gap-1.5">
        <span className="h-0.5 w-3" style={{ background: warna }} aria-hidden />
        {label}
      </dt>
      <dd className="text-right tabular-nums">{formatAngka(nilai)}</dd>
    </>
  );
}

export default IssueMap;
