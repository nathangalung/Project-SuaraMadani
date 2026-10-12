import {
  Children,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type OptionHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { kontrol } from "./Field";

interface Opsi {
  value: string;
  label: ReactNode;
  teks: string;
}

/** Ambil {value, label} dari anak <option> (array & kondisi false ikut diratakan) */
function bacaOpsi(children: ReactNode): Opsi[] {
  return Children.toArray(children).flatMap((c) => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(c) || c.type !== "option") return [];
    const label = c.props.children as ReactNode;
    return [{ value: String(c.props.value ?? ""), label, teks: typeof label === "string" ? label : String(c.props.value ?? "") }];
  });
}

/**
 * Dropdown bergaya KM. API-nya sama dengan <select> biasa (anak <option>, value/onChange, atau register()
 * react-hook-form): <select> asli tetap ada tapi tersembunyi sebagai penyimpan nilai, sementara yang terlihat
 * adalah tombol + daftar pilihan. Memilih opsi mengubah nilai <select> asli lalu memicu event "change",
 * jadi onChange & react-hook-form tetap jalan seperti biasa.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, id, disabled, value, defaultValue, "aria-invalid": invalid, ...rest },
  ref,
) {
  const opsi = bacaOpsi(children);
  const asli = useRef<HTMLSelectElement | null>(null);
  const kotak = useRef<HTMLDivElement>(null);
  const daftar = useRef<HTMLUListElement>(null);
  const idDaftar = useId();
  const [buka, setBuka] = useState(false);
  const [aktif, setAktif] = useState(0);
  const [terpilih, setTerpilih] = useState(() => String(value ?? defaultValue ?? opsi[0]?.value ?? ""));
  const ketikan = useRef({ teks: "", waktu: 0 });

  // Nilai bisa diubah dari luar (value terkontrol, setValue/reset react-hook-form) → selalu samakan dengan <select> asli
  useLayoutEffect(() => {
    const v = value !== undefined ? String(value) : asli.current?.value;
    if (v !== undefined && v !== terpilih) setTerpilih(v);
  });

  // Tutup bila klik di luar
  useEffect(() => {
    if (!buka) return;
    const luar = (e: PointerEvent) => !kotak.current?.contains(e.target as Node) && setBuka(false);
    document.addEventListener("pointerdown", luar);
    return () => document.removeEventListener("pointerdown", luar);
  }, [buka]);

  // Opsi aktif selalu terlihat saat dipindah dengan keyboard
  useEffect(() => {
    if (buka) daftar.current?.children[aktif]?.scrollIntoView({ block: "nearest" });
  }, [buka, aktif]);

  const sekarang = opsi.find((o) => o.value === terpilih) ?? opsi[0];
  const kosong = !sekarang || sekarang.value === "";
  // opsi bernilai kosong ("Pilih provinsi") cukup jadi teks petunjuk di tombol, tidak ikut di daftar
  const pilihan = opsi.filter((o) => o.value !== "");

  const bukaDaftar = () => {
    setAktif(Math.max(0, pilihan.findIndex((o) => o.value === terpilih)));
    setBuka(true);
  };

  const pilih = (o: Opsi) => {
    setBuka(false);
    kotak.current?.querySelector("button")?.focus();
    if (o.value === terpilih) return;
    const el = asli.current;
    if (el) {
      el.value = o.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (value === undefined) setTerpilih(o.value);
  };

  const tombol = (e: KeyboardEvent<HTMLButtonElement>) => {
    const geser = (i: number) => {
      e.preventDefault();
      if (!buka) return bukaDaftar();
      setAktif(Math.min(pilihan.length - 1, Math.max(0, i)));
    };
    switch (e.key) {
      case "ArrowDown":
        return geser(aktif + 1);
      case "ArrowUp":
        return geser(aktif - 1);
      case "Home":
        return geser(0);
      case "End":
        return geser(pilihan.length - 1);
      case "Enter":
      case " ":
        e.preventDefault();
        return buka ? pilihan[aktif] && pilih(pilihan[aktif]) : bukaDaftar();
      case "Escape":
        if (buka) e.preventDefault();
        return setBuka(false);
      case "Tab":
        return setBuka(false);
    }
    // ketik huruf awal untuk lompat (mis. "J" → Jawa Barat)
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const k = ketikan.current;
      const kini = Date.now();
      k.teks = (kini - k.waktu > 600 ? "" : k.teks) + e.key.toLowerCase();
      k.waktu = kini;
      const i = pilihan.findIndex((o) => o.teks.toLowerCase().startsWith(k.teks));
      if (i >= 0) {
        if (!buka) bukaDaftar();
        setAktif(i);
      }
    }
  };

  return (
    <div ref={kotak} className="relative w-full">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={buka}
        aria-controls={idDaftar}
        aria-activedescendant={buka ? `${idDaftar}-${aktif}` : undefined}
        aria-invalid={invalid}
        onClick={() => (buka ? setBuka(false) : bukaDaftar())}
        onKeyDown={tombol}
        onBlur={() => setBuka(false)}
        className={cn(
          kontrol,
          "flex h-12 cursor-pointer items-center pr-11 text-left disabled:cursor-not-allowed disabled:bg-km-navy/5 disabled:text-tinta-400",
          buka && "border-km-blue",
          kosong && "text-tinta-400",
          className,
        )}
      >
        <span className="truncate">{sekarang?.label}</span>
      </button>
      <ChevronDown
        className={cn("pointer-events-none absolute top-1/2 right-3.5 size-5 -translate-y-1/2 text-km-navy transition-transform", buka && "rotate-180")}
        aria-hidden
      />

      {buka && (
        <ul
          ref={daftar}
          id={idDaftar}
          role="listbox"
          aria-labelledby={id}
          // fokus tetap di tombol saat opsi diklik; preventDefault klik mencegah <label> pembungkus membuka ulang daftar
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto rounded-md border-2 border-km-navy bg-white py-1 text-base"
        >
          {pilihan.map((o, i) => {
            const dipilih = o.value === terpilih;
            return (
              <li
                key={o.value}
                id={`${idDaftar}-${i}`}
                role="option"
                aria-selected={dipilih}
                onPointerEnter={() => setAktif(i)}
                onClick={() => pilih(o)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-km-navy",
                  i === aktif && "bg-biru-100",
                  dipilih && "font-semibold text-km-blue",
                )}
              >
                <span>{o.label}</span>
                {dipilih && <Check className="size-4 shrink-0" aria-hidden />}
              </li>
            );
          })}
        </ul>
      )}

      {/* penyimpan nilai untuk form & react-hook-form; tidak terlihat dan tidak bisa difokus */}
      <select
        ref={(el) => {
          asli.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onFocus={() => kotak.current?.querySelector("button")?.focus()}
        {...rest}
      >
        {children}
      </select>
    </div>
  );
});
