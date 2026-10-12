import { useEffect, useRef, type ReactNode } from "react";

/*
 * Pop-up modal memakai <dialog> bawaan browser (fokus terkunci & tombol Esc otomatis).
 * Satu bayangan lembut karena melayang di atas halaman.
 */
interface Props {
  buka: boolean;
  onTutup: () => void;
  judul: string;
  children: ReactNode;
  aksi: ReactNode;
}

export function Dialog({ buka, onTutup, judul, children, aksi }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (buka && !d.open) d.showModal();
    if (!buka && d.open) d.close();
  }, [buka]);

  return (
    <dialog
      ref={ref}
      onClose={onTutup}
      onClick={(e) => e.target === ref.current && onTutup()}
      aria-labelledby="dialog-judul"
      className="dialog-masuk m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl bg-white p-0 text-km-navy shadow-[0_0_0_1px_rgb(8_38_110/0.06),0_16px_48px_rgb(8_38_110/0.3)] backdrop:bg-km-navy/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-6 sm:p-8">
        <h2 id="dialog-judul" className="font-judul text-2xl">
          {judul}
        </h2>
        <div className="mt-3 leading-relaxed text-tinta-700">{children}</div>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{aksi}</div>
      </div>
    </dialog>
  );
}
