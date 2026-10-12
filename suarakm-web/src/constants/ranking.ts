import type { IssueRankingKey } from "@/types/domain";

/** PDF §21 — Issue Ranking */
export const RANKING: { id: IssueRankingKey; label: string; deskripsi: string }[] = [
  { id: "terbanyak", label: "Paling banyak dilaporkan", deskripsi: "Isu dengan laporan terbanyak." },
  { id: "terdesak", label: "Paling mendesak", deskripsi: "Isu dengan tingkat urgensi tertinggi." },
  { id: "terdampak", label: "Paling banyak terdampak", deskripsi: "Isu dengan jumlah warga terdampak terbesar." },
  { id: "didukung", label: "Paling didukung", deskripsi: "Isu dengan dukungan masyarakat terbesar." },
  { id: "kepuasanTerendah", label: "Kepuasan terendah", deskripsi: "Isu dengan tingkat kepuasan publik terendah." },
  { id: "terlamaBelumSelesai", label: "Terlama belum selesai", deskripsi: "Isu yang paling lama belum mendapat penyelesaian." },
];
