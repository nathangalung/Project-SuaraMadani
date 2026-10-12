import { cn } from "@/lib/cn";
import { LANGKAH } from "../schema";

/** Bilah progres tipis di bawah judul langkah: selesai = navy, aktif = biru KM, berikutnya = abu */
export function ProgresLangkah({ aktif }: { aktif: number }) {
  return (
    <ol
      className="mt-3 grid grid-cols-7 gap-1"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={LANGKAH.length}
      aria-valuenow={aktif + 1}
      aria-label="Progres pengisian laporan"
    >
      {LANGKAH.map((l, i) => (
        <li key={l.judul} className={cn("h-1.5 rounded-full", i < aktif && "bg-km-navy", i === aktif && "bg-km-blue", i > aktif && "bg-km-navy/12")} />
      ))}
    </ol>
  );
}

/**
 * Daftar tahapan di kiri form (layar lebar): teks bernomor polos, tanpa lingkaran/ikon.
 * Aktif = tebal dengan garis biru di kiri; yang sudah dilewati bisa diklik untuk kembali.
 */
export function DaftarLangkah({ aktif, onPilih }: { aktif: number; onPilih: (i: number) => void }) {
  return (
    <nav aria-label="Tahapan laporan">
      <ol className="border-l border-km-navy/15">
        {LANGKAH.map((l, i) => {
          const isi = (
            <>
              <span className="block">
                {i + 1}. {l.judul}
              </span>
              <span className="block font-ui text-sm font-normal text-tinta-600">{l.deskripsi}</span>
            </>
          );
          return (
            <li key={l.judul} className={cn("-ml-px border-l-2 py-2.5 pl-4", i === aktif ? "border-km-blue" : "border-transparent")}>
              {i < aktif ? (
                <button type="button" onClick={() => onPilih(i)} className="cursor-pointer text-left text-km-navy hover:underline hover:underline-offset-4">
                  {isi}
                </button>
              ) : (
                <div aria-current={i === aktif ? "step" : undefined} className={cn(i === aktif ? "font-semibold text-km-navy" : "text-km-navy/50")}>
                  {isi}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
