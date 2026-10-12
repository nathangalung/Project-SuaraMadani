import { useId, useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ShieldCheck, Star } from "lucide-react";
import { Button, Card, useToast } from "@/components/ui";
import { rateIssue } from "@/services/issues.service";
import { cn } from "@/lib/cn";
import { formatAngka, formatSkor } from "@/lib/format";
import type { PublicIssue } from "@/types/domain";

const LABEL_SKOR = ["Sangat tidak puas", "Tidak puas", "Cukup", "Puas", "Sangat puas"];

/** Evaluasi publik (PDF §17) — sentimen publik, bukan ukuran objektif tunggal */
export function EvaluasiPublik({ issue }: { issue: PublicIssue }) {
  const [skor, setSkor] = useState<number | null>(null);
  const idJudul = useId();
  const toast = useToast();
  const kirim = useMutation({ mutationFn: (s: number) => rateIssue(issue.id, s), onSuccess: () => toast("Penilaianmu terkirim") });
  const bisaDinilai = issue.status === "direspons" || issue.status === "selesai";

  return (
    <Card varian="pastel" className="p-6">
      <h2 id={idJudul} className="font-bold text-2xl">
        Evaluasi publik
      </h2>

      <div className="mt-4 flex items-end gap-3">
        {issue.kepuasan !== null ? (
          <>
            <p className="font-bold text-5xl leading-none">
              {formatSkor(issue.kepuasan)}
              <span className="text-xl text-tinta-500"> / 5</span>
            </p>
            <p className="pb-1 text-sm text-tinta-600">dari {formatAngka(issue.jumlahPenilai)} penilai</p>
          </>
        ) : (
          <p className="text-tinta-600">Belum ada penilaian. Penilaian dibuka setelah pemerintah memberi respons.</p>
        )}
      </div>

      {bisaDinilai && (
        <>
          {kirim.isSuccess ? (
            <p role="status" className="mt-5 flex items-start gap-2 bg-km-green p-4 text-sm text-white">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              Penilaianmu tercatat (mode demo — belum tersimpan ke server).
            </p>
          ) : (
            <form
              className="mt-5 border-t border-km-navy/15 pt-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (skor) kirim.mutate(skor);
              }}
            >
              <fieldset>
                <legend className="font-semibold">
                  Seberapa puas kamu terhadap penanganan pemerintah atas isu ini?
                </legend>
                <div className="mt-3 flex gap-1.5">
                  {LABEL_SKOR.map((label, i) => {
                    const n = i + 1;
                    const aktif = skor !== null && n <= skor;
                    return (
                      <label key={n} className="cursor-pointer" title={label}>
                        <input
                          type="radio"
                          name={`skor-${issue.id}`}
                          value={n}
                          checked={skor === n}
                          onChange={() => setSkor(n)}
                          className="peer sr-only"
                        />
                        <span className="sr-only">
                          {n} — {label}
                        </span>
                        <Star
                          aria-hidden
                          className={cn(
                            "size-9 p-0.5 transition-colors peer-focus-visible:outline-3 peer-focus-visible:outline-km-blue",
                            aktif ? "fill-km-yellow text-km-orange" : "text-km-navy/25",
                          )}
                        />
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1.5 h-5 text-sm text-tinta-600" aria-live="polite">
                  {skor ? LABEL_SKOR[skor - 1] : ""}
                </p>
              </fieldset>

              <div className="mt-3 border-l-4 border-km-blue bg-white p-3.5 text-sm">
                Kamu perlu{" "}
                <Link to="/masuk" className="font-semibold text-km-blue underline underline-offset-2">
                  masuk
                </Link>{" "}
                untuk menilai. Di mode demo, penilaian tetap bisa dicoba.
              </div>

              <Button type="submit" varian="utama" className="mt-4 w-full" disabled={!skor || kirim.isPending}>
                {kirim.isPending ? "Mengirim…" : "Kirim penilaian"}
              </Button>
            </form>
          )}
        </>
      )}

      <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-tinta-600">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Satu suara per akun, dilindungi rate limiting, anti-bot, dan audit log. Skor ini adalah sentimen publik, bukan ukuran objektif
        tunggal keberhasilan pemerintah.
      </p>
    </Card>
  );
}
