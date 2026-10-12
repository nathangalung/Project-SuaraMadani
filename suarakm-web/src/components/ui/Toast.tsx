import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";

/*
 * Notifikasi kecil di bawah layar. Elemen melayang memakai satu bayangan lembut
 * (aturan Brex/Steep di styles.refero.design: bayangan hanya untuk UI yang melayang).
 */
interface Toast {
  id: number;
  pesan: string;
}

const Ctx = createContext<(pesan: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [daftar, setDaftar] = useState<Toast[]>([]);
  const nomor = useRef(0);

  const tutup = useCallback((id: number) => setDaftar((d) => d.filter((t) => t.id !== id)), []);
  const tampil = useCallback(
    (pesan: string) => {
      const id = ++nomor.current;
      setDaftar((d) => [...d.slice(-2), { id, pesan }]);
      setTimeout(() => tutup(id), 3500);
    },
    [tutup],
  );

  return (
    <Ctx.Provider value={tampil}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-[1500] flex flex-col items-center gap-2 px-4 sm:bottom-8">
        {daftar.map((t) => (
          <div
            key={t.id}
            className="toast-masuk pointer-events-auto flex items-center gap-3 rounded-[10px] bg-km-navy py-3 pr-2 pl-4 text-white shadow-[0_0_0_1px_rgb(8_38_110/0.06),0_8px_32px_rgb(8_38_110/0.28)]"
          >
            <CheckCircle2 className="size-5 shrink-0 text-km-mint" aria-hidden />
            <span className="font-ui font-semibold">{t.pesan}</span>
            <button type="button" onClick={() => tutup(t.id)} aria-label="Tutup notifikasi" className="grid size-8 place-items-center rounded-md hover:bg-white/10">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
