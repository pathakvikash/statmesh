import { notFound } from "next/navigation";
import { Answer } from "../answer-view";
import type { ChatEvent } from "@/lib/chat/events";

// Dev-only fixture: canned events through the real answer components, for checking layout by eye.
// Returns 404 in production builds.

const words = (s: string): ChatEvent[] => s.split(" ").map((w) => ({ t: "text", text: w + " " }));
const chart = {
  title: "Inflation", type: "line", unit: "index",
  series: [{ series_id: "fixture.cpi", label: "CPI", points: [{ period: "2019-01-01", value: 1.2 }, { period: "2020-01-01", value: 1.4 }, { period: "2021-01-01", value: 1.1 }] }],
  citations: [], warnings: [],
};

const EVENTS: ChatEvent[] = [
  ...words("I searched the catalog for robotics in India and found nothing matching."),
  { t: "call", id: "a", name: "search_series", input: { q: "robotics", geo: "IND", source: "datacommons" } },
  { t: "result", id: "a", name: "search_series", output: { query: "robotics", hits: [] } },
  ...words("Trying the wider labour series next."),
  { t: "call", id: "b", name: "get_observations", input: { series_id: "fixture.labour", start: "2010-01-01" } },
  { t: "result", id: "b", name: "get_observations", output: { series_id: "fixture.labour", status: "rate_limited", retry_after: 60, columns: [], rows: [], citations: [] } },
  { t: "call", id: "c", name: "run_sql", input: { sql: "select country, value from fixture_cpi where year = 2020" } },
  { t: "result", id: "c", name: "run_sql", output: { sql: "select", columns: ["country", "value"], rows: [["IND", 6.2]], truncated: false, citations: [] } },
  { t: "call", id: "d", name: "show_chart", input: { title: "Inflation", type: "line", series: [{ series_id: "fixture.cpi" }] } },
  { t: "result", id: "d", name: "show_chart", output: chart },
  { t: "call", id: "e", name: "get_observations", input: { series_id: "fixture.broken" } },
  { t: "result", id: "e", name: "get_observations", output: { error: "Connection to the data API timed out" } },
  { t: "call", id: "f", name: "show_chart", input: { title: "Broken", type: "bar", series: [{ series_id: "fixture.gone" }] } },
  { t: "result", id: "f", name: "show_chart", output: { unavailable: true } },
  ...words("Done."),
];

const RUNNING: ChatEvent[] = [
  ...words("Checking the series now."),
  { t: "call", id: "g", name: "search_series", input: { q: "unemployment", geo: "BGD" } },
];

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-10 p-4">
      <h1 className="text-lg font-semibold">Chat answer fixture</h1>
      <Answer events={EVENTS} userText="" />
      <Answer events={RUNNING} userText="" busy />
    </div>
  );
}
