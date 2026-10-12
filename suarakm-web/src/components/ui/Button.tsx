import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "@/lib/cn";

/*
 * Tombol ala km.itb.ac.id ("UKM", "Himpunan", "Unit Kegiatan Mahasiswa"):
 * biru KM solid (kontras tinggi untuk teks putih), sudut ~10px, Tilt Warp putih. Datar — bayangan 3D sudah ditolak.
 */
type Varian = "utama" | "km" | "kuning" | "garis" | "hantu" | "gelap";
type Ukuran = "sm" | "md" | "lg" | "xl";

const dasar =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-[transform,filter,background-color,box-shadow] duration-150 active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-50";

const varian: Record<Varian, string> = {
  utama: "rounded-[10px] bg-km-blue font-judul text-white hover:bg-biru-600",
  km: "rounded-[10px] bg-km-blue font-judul text-white hover:bg-biru-600",
  /** Untuk di atas gradien biru (hero beranda): kuning KM datar, garis navy; hover dibalik ke navy supaya jelas */
  kuning: "rounded-[10px] border-2 border-km-navy bg-km-yellow font-semibold text-km-navy hover:bg-km-navy hover:text-km-yellow",
  garis: "rounded-[10px] border-2 border-km-navy bg-white font-semibold text-km-navy hover:bg-km-navy hover:text-white",
  hantu: "rounded-[10px] text-km-navy hover:bg-km-navy/5",
  gelap: "rounded-[10px] bg-km-navy font-semibold text-white hover:bg-laut-800",
};

const ukuran: Record<Ukuran, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-base",
  lg: "h-13 px-7 text-lg",
  xl: "min-h-16 px-8 py-3 text-xl sm:text-2xl",
};

export function kelasTombol(v: Varian = "utama", u: Ukuran = "md", className?: string) {
  return cn(dasar, varian[v], ukuran[u], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  varian?: Varian;
  ukuran?: Ukuran;
  ikonKanan?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { varian: v = "utama", ukuran: u = "md", className, children, ikonKanan, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={kelasTombol(v, u, className)} {...rest}>
      {children}
      {ikonKanan}
    </button>
  );
});

interface ButtonLinkProps extends LinkProps {
  varian?: Varian;
  ukuran?: Ukuran;
  ikonKanan?: ReactNode;
}

export function ButtonLink({ varian: v = "utama", ukuran: u = "md", className, children, ikonKanan, ...rest }: ButtonLinkProps) {
  return (
    <Link className={kelasTombol(v, u, typeof className === "string" ? className : undefined)} {...rest}>
      {children}
      {ikonKanan}
    </Link>
  );
}
