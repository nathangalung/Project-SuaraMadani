import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui";
import { q } from "@/services/queries";
import { TuntutanLedger } from "./TuntutanLedger";

export function TuntutanList() {
  const { data, isLoading } = useQuery(q.tuntutan());
  const { data: isu } = useQuery(q.issues());

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  return <TuntutanLedger data={data} isu={isu} lengkap />;
}
