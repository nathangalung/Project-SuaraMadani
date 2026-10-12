import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Menu, X } from "lucide-react";
import { NAV_UTAMA } from "@/constants/site";
import { cn } from "@/lib/cn";
import { Button, ButtonLink } from "@/components/ui";
import { hapusSesi, useSesi } from "@/features/auth/sesi";
import { logout } from "@/services/auth.service";
import { Logo } from "./Logo";

/** Navbar gradien mint → kuning setinggi navbar km.itb.ac.id */
export function Navbar() {
  const [buka, setBuka] = useState(false);
  const lokasi = useLocation();
  useEffect(() => setBuka(false), [lokasi.pathname]);
  const sesi = useSesi();
  // Sesi lokal tetap dihapus walau permintaan logout ke server gagal
  const keluar = () => void logout().catch(() => {}).finally(hapusSesi);

  return (
    <header className="gradien-navbar sticky top-0 z-[1000]">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8 lg:h-24">
        <Logo />

        <nav aria-label="Navigasi utama" className="hidden xl:block">
          <ul className="flex items-center gap-7">
            {NAV_UTAMA.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.to === "/"} className="group/item relative flex items-center gap-1 py-1 text-lg whitespace-nowrap text-km-navy">
                  {({ isActive }) => (
                    <>
                      {/* halaman aktif: stabilo kuning miring + bintang (penanda "kamu di sini", pola navbar km.itb.ac.id) */}
                      {isActive && <span aria-hidden className="absolute right-4 bottom-1 left-0 h-[15px] -rotate-[2.3deg] bg-km-yellow" />}
                      {/* disorot: cukup garis bawah tipis — berbeda dari penanda halaman aktif */}
                      <span
                        className={cn(
                          "relative",
                          isActive
                            ? "font-semibold"
                            : "underline decoration-transparent decoration-2 underline-offset-[6px] transition-[text-decoration-color] duration-200 group-hover/item:decoration-km-navy",
                        )}
                      >
                        {n.label}
                      </span>
                      {isActive && (
                        <img
                          src="/landing/navlink-star.webp"
                          alt=""
                          aria-hidden
                          className="pointer-events-none relative -mt-2 w-[11px] max-w-none self-start rotate-[130deg]"
                        />
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-5 xl:flex">
          {sesi ? (
            <>
              <span className="max-w-64 truncate text-km-navy" title={sesi.email}>
                {sesi.email}
              </span>
              <Button varian="garis" ukuran="md" onClick={keluar}>
                Keluar
              </Button>
            </>
          ) : (
            <>
              <Link to="/masuk" className="text-km-navy hover:underline">
                Masuk
              </Link>
              <ButtonLink to="/masuk?mode=daftar" varian="garis" ukuran="md">
                Daftar
              </ButtonLink>
            </>
          )}
        </div>

        <button
          type="button"
          className="grid size-11 place-items-center text-km-navy xl:hidden"
          aria-expanded={buka}
          aria-controls="menu-seluler"
          aria-label={buka ? "Tutup menu" : "Buka menu"}
          onClick={() => setBuka((b) => !b)}
        >
          {buka ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>

      {buka && (
        <nav id="menu-seluler" aria-label="Navigasi seluler" className="bg-km-cream xl:hidden">
          <ul className="mx-auto flex max-w-7xl flex-col px-6 pb-6">
            {NAV_UTAMA.map((n) => (
              <li key={n.to} className="border-b border-km-navy/10">
                <NavLink to={n.to} end={n.to === "/"} className={({ isActive }) => cn("block py-4 text-lg text-km-navy", isActive && "font-semibold")}>
                  {n.label}
                </NavLink>
              </li>
            ))}
            {sesi ? (
              <>
                <li className="border-b border-km-navy/10 py-4 text-km-navy">
                  <span className="block text-sm">Masuk sebagai</span>
                  <span className="block truncate text-lg">{sesi.email}</span>
                </li>
                <li className="pt-5">
                  <Button varian="garis" ukuran="lg" className="w-full" onClick={keluar}>
                    Keluar
                  </Button>
                </li>
              </>
            ) : (
              <>
                <li className="border-b border-km-navy/10">
                  <NavLink to="/masuk" className="block py-4 text-lg text-km-navy">
                    Masuk
                  </NavLink>
                </li>
                <li className="pt-5">
                  <ButtonLink to="/masuk?mode=daftar" varian="garis" ukuran="lg" className="w-full">
                    Daftar
                  </ButtonLink>
                </li>
              </>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}
