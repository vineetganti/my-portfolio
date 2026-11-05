import { labItem } from "@/lib/dbLab";
import TxnTheaterView from "@/components/db/TxnTheaterView";

/** `<TxnTheater src="acid/lost-update" />`: a recorded multi-session run from content/db-lab. */
export default function TxnTheater({ src }: { src: string }) {
  return <TxnTheaterView theater={labItem("theaters", src)} />;
}
