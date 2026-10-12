const angka = new Intl.NumberFormat("id-ID");
const ringkas = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
const tanggal = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const tanggalPanjang = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" });
const bulan = new Intl.DateTimeFormat("id-ID", { month: "short" });

export const formatAngka = (n: number) => angka.format(n);
export const formatRingkas = (n: number) => ringkas.format(n);
export const formatTanggal = (iso: string) => tanggal.format(new Date(iso));
export const formatTanggalPanjang = (iso: string) => tanggalPanjang.format(new Date(iso));
export const formatBulan = (yyyyMm: string) => bulan.format(new Date(`${yyyyMm}-01T00:00:00`));
export const formatSkor = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Jumlah hari sejak tanggal ISO sampai sekarang */
export function hariSejak(iso: string, sekarang = new Date()) {
  return Math.max(0, Math.floor((sekarang.getTime() - new Date(iso).getTime()) / 86_400_000));
}

export function waktuRelatif(iso: string) {
  const h = hariSejak(iso);
  if (h === 0) return "hari ini";
  if (h === 1) return "kemarin";
  if (h < 30) return `${h} hari lalu`;
  const b = Math.floor(h / 30);
  return `${b} bulan lalu`;
}
