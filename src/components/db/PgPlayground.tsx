import { labItem } from "@/lib/dbLab";
import PgPlaygroundView from "@/components/db/PgPlaygroundView";

/** `<PgPlayground src="acid/atomicity" />` in a post: a live SQL box from content/db-lab/acid.json. */
export default function PgPlayground({ src }: { src: string }) {
  return <PgPlaygroundView id={src} box={labItem("playgrounds", src)} />;
}
