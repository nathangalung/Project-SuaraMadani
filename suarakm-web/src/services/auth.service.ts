import { http, tunda, USE_MOCK } from "./http";

/** Alur MVP (PDF §8): Verified Email → Account → Optional Additional Verification */
export async function requestOtp(email: string): Promise<{ terkirim: true; email: string }> {
  if (!USE_MOCK) return http("/auth/otp", { method: "POST", body: JSON.stringify({ email }) });
  return tunda({ terkirim: true as const, email }, 700);
}

export async function verifyOtp(email: string, kode: string): Promise<{ ok: boolean }> {
  if (!USE_MOCK) return http("/auth/otp/verify", { method: "POST", body: JSON.stringify({ email, kode }) });
  // mock: kode apa pun 6 digit diterima
  return tunda({ ok: /^\d{6}$/.test(kode) }, 700);
}

export async function logout(): Promise<void> {
  if (!USE_MOCK) await http("/auth/logout", { method: "POST" });
}
