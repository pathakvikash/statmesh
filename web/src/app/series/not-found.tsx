import { NotFoundState } from "@/components/StateShell";

export default function SeriesNotFound() {
  return <NotFoundState title="Series not found">This series id may have changed, or it may be a whole dataset rather than one series. Search to find the current one.</NotFoundState>;
}
