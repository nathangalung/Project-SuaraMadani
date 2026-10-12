import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Fieldset untuk kelompok radio/checkbox, setara `Field` untuk input tunggal */
export function Grup({
  legend,
  bantuan,
  galat,
  wajib,
  children,
  className,
}: {
  legend: ReactNode;
  bantuan?: ReactNode;
  galat?: string;
  wajib?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-1.5 font-semibold">
        {legend}
        {wajib && (
          <span className="ml-0.5 text-km-red" aria-hidden>
            *
          </span>
        )}
      </legend>
      {bantuan && <p className="mb-3 text-sm text-tinta-600">{bantuan}</p>}
      <div className={cn(!bantuan && "mt-2")}>{children}</div>
      {galat && (
        <p role="alert" className="mt-2 text-sm font-semibold text-km-red">
          {galat}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Pilihan pendek (urgensi, kelompok terdampak, dll.) sebagai radio/checkbox polos sebaris — tanpa kotak/chip.
 * Pemanggil masih mengirim input ber-`sr-only`; di sini dibuat terlihat lagi.
 */
export function Segmen({ label, className, input }: { label: ReactNode; className?: string; input: ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 py-1 text-km-navy select-none",
        "[&>input]:not-sr-only [&>input]:size-5 [&>input]:shrink-0 [&>input]:cursor-pointer [&>input]:accent-km-blue",
        className,
      )}
    >
      {input}
      {label}
    </label>
  );
}

/** Catatan berlatar: krem (umum), biru (privasi), mint (berhasil/tips) — garis kiri, tanpa ikon */
export function Catatan({ children, nada = "krem" }: { children: ReactNode; nada?: "krem" | "biru" | "mint" }) {
  return (
    <div
      className={cn(
        "border-l-4 p-4 text-sm leading-relaxed",
        nada === "krem" && "border-km-navy/30 bg-km-cream",
        nada === "biru" && "bg-[#eef4fd] border-km-blue",
        nada === "mint" && "border-km-green bg-mint-100",
      )}
    >
      {children}
    </div>
  );
}
