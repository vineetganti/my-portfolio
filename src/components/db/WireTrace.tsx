import { labItem } from "@/lib/dbLab";
import WireTraceView, { type WireData } from "@/components/db/WireTraceView";

/** `<WireTrace src="security/wire" />`: a real capture of a database conversation. */
export default function WireTrace({ src }: { src: string }) {
  return <WireTraceView data={labItem("data", src) as WireData} />;
}
