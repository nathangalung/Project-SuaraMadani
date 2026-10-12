import { ButtonLink, SectionHeading } from "@/components/ui";
import { LatarPastel } from "@/components/decor/Ornamen";

export default function NotFoundPage() {
  return (
    <LatarPastel className="px-4 py-28 text-center">
      <p className="font-judul text-8xl text-km-blue">404</p>
      <SectionHeading
        className="mt-6"
        judul="Halaman tidak ditemukan"
        rata="tengah"
        deskripsi="Tautan mungkin salah ketik atau isu sudah dipindahkan."
      />
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <ButtonLink to="/">Ke beranda</ButtonLink>
        <ButtonLink to="/jelajah" varian="garis">
          Jelajah isu
        </ButtonLink>
      </div>
    </LatarPastel>
  );
}
