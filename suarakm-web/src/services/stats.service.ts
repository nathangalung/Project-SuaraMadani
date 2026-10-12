import { PROVINSI_AGREGAT } from "@/mocks/provinsi";
import { HEADLINE, SEBARAN_KEPUASAN, STATISTIK, TREN_BULANAN } from "@/mocks/stats";
import type { HeadlineBerita, ProvinsiAgregat, StatistikNasional, TrenBulanan } from "@/types/domain";
import { http, tunda, USE_MOCK } from "./http";

export async function getStatistik(): Promise<StatistikNasional> {
  if (!USE_MOCK) return http("/stats");
  return tunda(STATISTIK);
}

export async function getAgregatProvinsi(): Promise<ProvinsiAgregat[]> {
  if (!USE_MOCK) return http("/stats/provinsi");
  return tunda(PROVINSI_AGREGAT);
}

export async function getTren(): Promise<TrenBulanan[]> {
  if (!USE_MOCK) return http("/stats/tren");
  return tunda(TREN_BULANAN);
}

export async function getSebaranKepuasan(): Promise<{ skor: number; jumlah: number }[]> {
  if (!USE_MOCK) return http("/stats/kepuasan");
  return tunda(SEBARAN_KEPUASAN);
}

export async function getHeadline(): Promise<HeadlineBerita[]> {
  if (!USE_MOCK) return http("/headline");
  return tunda(HEADLINE);
}
