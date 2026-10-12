import { HeroKM } from "@/features/home/sections/HeroKM";
import { BandKM } from "@/features/home/sections/BandKM";
import { IsuTerbaru, TuntutanPublik } from "@/features/home/sections/DaftarBeranda";
import { LatarKM } from "@/features/home/LatarKM";

/** Beranda: pola km.itb.ac.id — hero, band biru, lalu kartu isu & tuntutan di latar pastel */
export default function HomePage() {
  return (
    <>
      <div className="relative bg-[linear-gradient(180deg,#0f49d4_0%,#0f49d4_34%,#08266e_100%)]">
        <HeroKM />
        <BandKM />
      </div>
      <LatarKM>
        <IsuTerbaru />
        <TuntutanPublik />
      </LatarKM>
    </>
  );
}
