import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const kontrol =
  "w-full rounded-md border-2 border-km-navy/15 bg-white px-4 text-base text-km-navy placeholder:text-tinta-400 transition-colors focus:border-km-blue focus:outline-none aria-[invalid=true]:border-km-red";

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  bantuan?: ReactNode;
  galat?: string;
  wajib?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, bantuan, galat, wajib, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="font-semibold text-km-navy">
        {label}
        {wajib && <span className="ml-0.5 text-km-red" aria-hidden>*</span>}
      </label>
      {bantuan && <p className="-mt-0.5 font-ui text-[0.95rem] text-tinta-600">{bantuan}</p>}
      {children}
      {galat && (
        <p role="alert" className="text-sm font-semibold text-km-red">
          {galat}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(kontrol, "h-12", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(kontrol, "min-h-32 py-3 leading-relaxed", className)} {...rest} />;
});

/** Pilihan radio/checkbox polos ala formulir Bijak Memantau/GOV.UK: lingkaran + label, keterangan abu di bawahnya, tanpa kotak */
export const Pilihan = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; deskripsi?: ReactNode }
>(function Pilihan({ label, deskripsi, className, type = "radio", ...rest }, ref) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 py-1", className)}>
      <input ref={ref} type={type} className="mt-0.5 size-5 shrink-0 cursor-pointer accent-km-blue" {...rest} />
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold text-km-navy">{label}</span>
        {deskripsi && <span className="font-ui text-[0.95rem] text-tinta-600">{deskripsi}</span>}
      </span>
    </label>
  );
});
