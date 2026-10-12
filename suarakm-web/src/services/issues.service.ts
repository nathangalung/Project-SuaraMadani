import { ISSUES } from "@/mocks/issues";
import { TUNTUTAN } from "@/mocks/tuntutan";
import { URGENSI } from "@/constants/status";
import type { IssueFilter, IssueRankingKey, PublicIssue, Tuntutan } from "@/types/domain";
import { http, tunda, USE_MOCK } from "./http";

const bobotUrgensi = Object.fromEntries(URGENSI.map((u, i) => [u.id, i]));

export function urutkanIsu(list: PublicIssue[], kunci: IssueRankingKey = "terbaru") {
  const salin = [...list];
  const belumSelesai = (i: PublicIssue) => i.status !== "selesai";
  switch (kunci) {
    case "terbanyak":
      return salin.sort((a, b) => b.jumlahLaporan - a.jumlahLaporan);
    case "terdesak":
      return salin.sort((a, b) => bobotUrgensi[b.urgensi] - bobotUrgensi[a.urgensi] || b.jumlahLaporan - a.jumlahLaporan);
    case "terdampak":
      return salin.sort((a, b) => b.estimasiTerdampak - a.estimasiTerdampak);
    case "didukung":
      return salin.sort((a, b) => b.dukungan - a.dukungan);
    case "kepuasanTerendah":
      return salin.filter((i) => i.kepuasan !== null).sort((a, b) => (a.kepuasan ?? 5) - (b.kepuasan ?? 5));
    case "terlamaBelumSelesai":
      return salin.filter(belumSelesai).sort((a, b) => a.dibuat.localeCompare(b.dibuat));
    case "terbaru":
    default:
      return salin.sort((a, b) => b.diperbarui.localeCompare(a.diperbarui));
  }
}

export async function getIssues(filter: IssueFilter = {}): Promise<PublicIssue[]> {
  if (!USE_MOCK) return http(`/issues?${new URLSearchParams(filter as Record<string, string>)}`);
  const q = filter.q?.trim().toLowerCase();
  const hasil = ISSUES.filter((i) => {
    if (filter.kategori && filter.kategori !== "semua" && i.kategori !== filter.kategori) return false;
    if (filter.status && filter.status !== "semua" && i.status !== filter.status) return false;
    if (filter.provinsiId && filter.provinsiId !== "semua" && i.wilayah.provinsiId !== filter.provinsiId) return false;
    if (q && !`${i.judul} ${i.ringkasan} ${i.subkategori} ${i.wilayah.provinsi} ${i.wilayah.kabupaten ?? ""} ${i.instansi}`.toLowerCase().includes(q))
      return false;
    return true;
  });
  return tunda(urutkanIsu(hasil, filter.urutkan));
}

export async function getIssue(id: string): Promise<PublicIssue | null> {
  if (!USE_MOCK) return http(`/issues/${id}`);
  return tunda(ISSUES.find((i) => i.id === id) ?? null);
}

export async function getTuntutan(): Promise<Tuntutan[]> {
  if (!USE_MOCK) return http("/tuntutan");
  return tunda(TUNTUTAN);
}

export async function supportIssue(id: string): Promise<{ dukungan: number }> {
  if (!USE_MOCK) return http(`/issues/${id}/support`, { method: "POST" });
  const isu = ISSUES.find((i) => i.id === id);
  return tunda({ dukungan: (isu?.dukungan ?? 0) + 1 });
}

/** Satu suara per akun (PDF §17) — anti-manipulasi ditangani backend */
export async function rateIssue(id: string, skor: number): Promise<{ ok: true }> {
  if (!USE_MOCK) return http(`/issues/${id}/rating`, { method: "POST", body: JSON.stringify({ skor }) });
  return tunda({ ok: true as const });
}
