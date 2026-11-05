import { labItem } from "@/lib/dbLab";
import PlanMatrixView, { type MatrixData } from "@/components/db/PlanMatrixView";

/** `<PlanMatrix src="indexing/matrix" />`: real plans for several index layouts. */
export default function PlanMatrix({ src }: { src: string }) {
  return <PlanMatrixView data={labItem("data", src) as MatrixData} />;
}
