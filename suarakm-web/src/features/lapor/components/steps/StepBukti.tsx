import { useEffect, useRef, useState, type DragEvent } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Link2, Trash2, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { LaporInput } from "../../types";
import { Catatan, Grup } from "../Grup";

const MAKS_BERKAS = 5;
const MAKS_UKURAN = 20 * 1024 * 1024; // 20 MB
const TERIMA = "image/*,video/*,application/pdf";

function ukuranTerbaca(b: number) {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
}

function tipeDiterima(f: File) {
  return f.type.startsWith("image/") || f.type.startsWith("video/") || f.type === "application/pdf";
}

function Pratinjau({ berkas }: { berkas: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!berkas.type.startsWith("image/")) return;
    const u = URL.createObjectURL(berkas);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [berkas]);

  if (url) return <img src={url} alt="" className="size-14 shrink-0 object-cover" />;
  const Ikon = berkas.type.startsWith("video/") ? Film : FileText;
  return (
    <span className="grid size-14 shrink-0 place-items-center bg-km-cream">
      <Ikon className="size-6" aria-hidden />
    </span>
  );
}

export function StepBukti() {
  const {
    register,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useFormContext<LaporInput>();
  const { fields, append, remove } = useFieldArray({ control, name: "linkSumber" });
  const lampiran = (watch("lampiran") ?? []) as File[];
  const [tolak, setTolak] = useState<string | null>(null);
  const [seret, setSeret] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tambah = (daftar: FileList | File[]) => {
    const masuk = Array.from(daftar);
    const alasan: string[] = [];
    const lolos = masuk.filter((f) => {
      if (!tipeDiterima(f)) {
        alasan.push(`${f.name}: format tidak didukung`);
        return false;
      }
      if (f.size > MAKS_UKURAN) {
        alasan.push(`${f.name}: lebih dari 20 MB`);
        return false;
      }
      return true;
    });
    const sisaSlot = MAKS_BERKAS - lampiran.length;
    if (lolos.length > sisaSlot) alasan.push(`Maksimal ${MAKS_BERKAS} berkas — ${lolos.length - Math.max(0, sisaSlot)} berkas tidak ditambahkan`);
    setValue("lampiran", [...lampiran, ...lolos.slice(0, Math.max(0, sisaSlot))], { shouldValidate: true, shouldDirty: true });
    setTolak(alasan.length ? alasan.join(". ") + "." : null);
  };

  const hapus = (i: number) => {
    setValue(
      "lampiran",
      lampiran.filter((_, j) => j !== i),
      { shouldValidate: true, shouldDirty: true },
    );
    setTolak(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setSeret(false);
    if (e.dataTransfer.files.length) tambah(e.dataTransfer.files);
  };

  const penuh = lampiran.length >= MAKS_BERKAS;

  return (
    <div className="flex flex-col gap-6">
      <Catatan nada="mint">
        Laporan yang disertai bukti lebih cepat diverifikasi. Bukti bersifat opsional, tapi sangat membantu.
      </Catatan>

      <Grup legend="Foto, video, atau dokumen" bantuan={`Maksimal ${MAKS_BERKAS} berkas, masing-masing hingga 20 MB (JPG, PNG, MP4, PDF).`}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!penuh) setSeret(true);
          }}
          onDragLeave={() => setSeret(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-3 border-2 border-dashed px-4 py-8 text-center transition-colors",
            seret ? "bg-[#eef4fd] border-km-blue" : "border-km-navy/35 bg-white",
            penuh && "opacity-60",
          )}
        >
          <div>
            <p className="font-semibold">{penuh ? "Batas berkas tercapai" : "Seret berkas ke sini"}</p>
            <p className="text-sm text-tinta-600">{penuh ? "Hapus salah satu untuk menambah yang lain." : "atau pilih dari perangkatmu"}</p>
          </div>
          <Button varian="garis" ukuran="sm" disabled={penuh} onClick={() => inputRef.current?.click()}>
            Pilih berkas
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={TERIMA}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              if (e.target.files) tambah(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {(tolak || errors.lampiran?.message) && (
          <p role="alert" className="mt-2 text-sm font-semibold text-km-red">
            {tolak ?? errors.lampiran?.message}
          </p>
        )}

        {lampiran.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Berkas terlampir">
            {lampiran.map((f, i) => (
              <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-3 border border-km-navy/12 bg-white p-2.5">
                <Pratinjau berkas={f} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{f.name}</p>
                  <p className="text-xs text-tinta-500">{ukuranTerbaca(f.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => hapus(i)}
                  className="grid size-9 shrink-0 place-items-center text-tinta-600 hover:bg-km-red hover:text-white"
                  aria-label={`Hapus ${f.name}`}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Grup>

      <Grup legend="Tautan sumber" bantuan="Berita, unggahan media sosial, atau dokumen publik yang mendukung laporanmu.">
        <div className="flex flex-col gap-3">
          {fields.map((f, i) => {
            const galat = errors.linkSumber?.[i]?.url?.message;
            return (
              <div key={f.id}>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Link2 className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-tinta-400" aria-hidden />
                    <Input
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                      className="pl-10"
                      aria-label={`Tautan sumber ${i + 1}`}
                      aria-invalid={!!galat}
                      {...register(`linkSumber.${i}.url` as const)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="grid size-12 shrink-0 place-items-center text-tinta-600 hover:bg-km-red hover:text-white"
                    aria-label={`Hapus tautan ${i + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
                {galat && (
                  <p role="alert" className="mt-1.5 text-sm font-semibold text-km-red">
                    {galat}
                  </p>
                )}
              </div>
            );
          })}
          {fields.length < 5 && (
            <Button varian="garis" ukuran="sm" className="self-start" onClick={() => append({ url: "" })}>
              Tambah tautan
            </Button>
          )}
        </div>
      </Grup>

      <p className="text-sm leading-relaxed text-tinta-600">
        Pastikan bukti tidak menampilkan data pribadi orang lain seperti KTP, wajah anak, atau nomor rumah. Tim akan menyamarkan
        informasi sensitif sebelum isu dipublikasikan.
      </p>
    </div>
  );
}
