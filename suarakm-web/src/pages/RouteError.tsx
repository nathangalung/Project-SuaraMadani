import { isRouteErrorResponse, useRouteError } from "react-router";
import { ButtonLink, SectionHeading } from "@/components/ui";

export function RouteError() {
  const err = useRouteError();
  const pesan = isRouteErrorResponse(err) ? `${err.status} — ${err.statusText}.` : "Halaman gagal dimuat.";
  return (
    <div className="bg-km-cream px-4 py-28 text-center">
      <SectionHeading judul="Ada kendala" rata="tengah" deskripsi={`${pesan} Muat ulang halaman, atau kembali ke beranda.`} />
      <ButtonLink to="/" className="mt-8">
        Ke beranda
      </ButtonLink>
    </div>
  );
}
