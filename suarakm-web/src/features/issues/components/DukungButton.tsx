import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ThumbsUp } from "lucide-react";
import { supportIssue } from "@/services/issues.service";
import { cn } from "@/lib/cn";
import { kelasTombol, useToast } from "@/components/ui";
import { formatAngka } from "@/lib/format";

/** Tombol dukung dengan pembaruan optimistis */
export function DukungButton({ issueId, awal, className }: { issueId: string; awal: number; className?: string }) {
  const [jumlah, setJumlah] = useState(awal);
  const [didukung, setDidukung] = useState(false);
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => supportIssue(issueId),
    onMutate: () => {
      setDidukung(true);
      setJumlah((j) => j + 1);
    },
    onSuccess: () => toast("Dukunganmu tercatat"),
    onError: () => {
      setDidukung(false);
      setJumlah((j) => j - 1);
    },
  });

  return (
    <button
      type="button"
      onClick={() => m.mutate()}
      disabled={didukung}
      aria-pressed={didukung}
      className={cn(
        didukung
          ? "inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-km-green px-6 font-semibold text-white"
          : kelasTombol("utama", "md", "h-12 px-6"),
        className,
      )}
    >
      <ThumbsUp className={cn("size-4.5", didukung && "fill-current")} aria-hidden />
      {didukung ? "Kamu mendukung isu ini" : "Dukung isu ini"}
      <span className="bg-km-navy/25 px-2 py-0.5 font-sans text-sm font-semibold">{formatAngka(jumlah)}</span>
    </button>
  );
}
