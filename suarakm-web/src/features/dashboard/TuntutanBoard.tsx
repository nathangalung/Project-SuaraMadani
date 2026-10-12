import { Link } from "react-router";
import { Card } from "@/components/ui";
import { TuntutanLedger } from "@/features/issues/components/TuntutanLedger";
import type { Tuntutan } from "@/types/domain";

/** Panel tuntutan dashboard (wireframe PDF: "Tuntutan 1–4" + indikator ya/tidak) */
export function TuntutanBoard({ data }: { data: Tuntutan[] }) {
  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <h2 className="text-2xl font-bold">Tuntutan publik</h2>
      <p className="mt-1 font-ui text-sm text-tinta-700">Disusun dari isu terverifikasi, dikawal sampai dipenuhi.</p>
      <TuntutanLedger data={data} rapat className="mt-5" />
      <Link to="/jelajah?tab=tuntutan" className="mt-auto self-start pt-5 font-semibold text-km-blue hover:underline">
        Lihat semua tuntutan & isu terkait
      </Link>
    </Card>
  );
}
