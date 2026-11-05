import { labItem } from "@/lib/dbLab";
import HotViewClient, { type HotData } from "@/components/db/HotViewClient";

/** `<HotView src="internals/hot-steps" />`: a row and its index entry through several updates. */
export default function HotView({ src }: { src: string }) {
  return <HotViewClient data={labItem("data", src) as HotData} />;
}
