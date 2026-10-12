import { Link } from "react-router";
import { AtSign, Mail } from "lucide-react";
import { NAV_UTAMA, SITE } from "@/constants/site";

/*
 * Footer ringkas ala km.itb.ac.id: latar gradasi pastel polos (kuning → mint), lambang KM, tautan, kontak,
 * lalu satu baris kredit.
 */
export function Footer() {
  return (
    <footer className="w-full bg-[linear-gradient(90deg,#fff1a6_0%,#f6f7df_55%,#c8f2e8_100%)] text-km-navy">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 sm:px-10 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <img src="/logo-km.png" alt="Lambang Keluarga Mahasiswa ITB" className="size-14 shrink-0 object-contain" />
          <div>
            <p className="text-xl font-bold">SuaraKM</p>
            <p className="text-sm">{SITE.kabinet}</p>
          </div>
        </div>

        <nav aria-label="Tautan footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {NAV_UTAMA.slice(1).map((n) => (
              <li key={n.to}>
                <Link to={n.to} className="hover:underline">
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/lacak" className="hover:underline">
                Lacak laporan
              </Link>
            </li>
          </ul>
        </nav>

        <div className="flex flex-col gap-1 font-ui">
          <a href={`mailto:${SITE.kontak.email}`} className="inline-flex items-center gap-2 hover:underline">
            <Mail className="size-4" aria-hidden /> {SITE.kontak.email}
          </a>
          <a href={SITE.kontak.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:underline">
            <AtSign className="size-4" aria-hidden /> km.itb
          </a>
        </div>
      </div>

      <div className="border-t border-km-navy/15">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-6 py-4 text-sm sm:px-10 md:flex-row md:justify-between">
          <p>© 2026 KM ITB. All Rights Reserved</p>
          <p>
            <span className="text-km-blue">Developed by</span> {SITE.kredit.developedBy}
          </p>
        </div>
      </div>
    </footer>
  );
}
