/**
 * Klien HTTP tipis. Selama VITE_API_BASE_URL kosong, semua service memakai data mock
 * sehingga frontend bisa dikembangkan tanpa backend.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;
export const USE_MOCK = !API_BASE_URL;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<T>;
}

/** Simulasi latensi jaringan untuk data mock */
export const tunda = <T>(data: T, ms = 350) => new Promise<T>((r) => setTimeout(() => r(data), ms));
