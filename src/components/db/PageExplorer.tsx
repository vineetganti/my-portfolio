import { labItem } from "@/lib/dbLab";
import PageExplorerView, { type PageData } from "@/components/db/PageExplorerView";

/** `<PageExplorer src="disk/page-steps" />`: a real page, recorded after each step. */
export default function PageExplorer({ src }: { src: string }) {
  return <PageExplorerView data={labItem("data", src) as PageData} />;
}
