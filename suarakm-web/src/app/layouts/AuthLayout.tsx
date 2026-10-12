import { Outlet, ScrollRestoration } from "react-router";
import { Logo } from "@/components/layout/Logo";
import { LatarPastel } from "@/components/decor/Ornamen";

/** Layout halaman masuk — latar pastel KM tanpa navbar penuh */
export function AuthLayout() {
  return (
    <LatarPastel className="flex min-h-svh flex-col">
      <header className="gradien-navbar">
        <div className="mx-auto flex h-20 max-w-7xl items-center px-4 sm:px-8">
          <Logo />
        </div>
      </header>
      <main id="konten" className="relative flex flex-1 items-center justify-center px-4 py-16">
        <Outlet />
      </main>
      <ScrollRestoration />
    </LatarPastel>
  );
}
