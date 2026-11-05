import { labItem } from "@/lib/dbLab";
import LabChartView from "@/components/db/LabChartView";

/** `<LabChart src="indexing/plan-flip" />`: a chart of measured numbers from content/db-lab. */
export default function LabChart({ src }: { src: string }) {
  return <LabChartView chart={labItem("charts", src)} />;
}
