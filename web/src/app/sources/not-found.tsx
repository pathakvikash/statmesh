import { NotFoundState } from "@/components/StateShell";

export default function SourceNotFound() {
  return <NotFoundState title="Source not found">This source id is not in the catalog, or it is not available in this mode. Browse the sources or search instead.</NotFoundState>;
}
