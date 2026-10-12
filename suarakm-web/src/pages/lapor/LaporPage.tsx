import { Link } from "react-router";
import { Container, PageHeader } from "@/components/ui";
import { LatarPastel } from "@/components/decor/Ornamen";
import { LaporForm } from "@/features/lapor/components/LaporForm";
import { useSesi } from "@/features/auth/sesi";

export default function LaporPage() {
  const sesi = useSesi();
  return (
    <>
      <PageHeader
        judul="KM Lapor!"
        deskripsi="Laporanmu diverifikasi tim, digabung dengan laporan serupa, lalu dipantau bersama sampai ada penyelesaian."
      />

      <LatarPastel className="mt-8" ornamen={false}>
        <Container className="relative max-w-5xl py-10 sm:py-14">
          {!sesi && (
            <p className="mb-6 leading-relaxed text-km-navy">
              Laporan baru bisa dikirim setelah kamu{" "}
              <Link to="/masuk?next=/lapor" className="font-semibold text-km-blue underline underline-offset-4 hover:text-km-navy">
                masuk dengan email
              </Link>
              .
            </p>
          )}

          <LaporForm />
        </Container>
      </LatarPastel>
    </>
  );
}
