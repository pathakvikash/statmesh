// Curated headline indicators. Only series ids and plain labels live here; every number is read from the catalogue
// (rule 7). Candidates are in priority order: hosted serves licence=yes data only (World Bank, ILOSTAT, UN SDG,
// Eurostat, BLS, ECB), so those come first; review-licence sources (OWID, WHO, IMF, FRED, Data Commons) only exist on local instances.
import type { SeriesStat } from "./data";

export type CoreSlot = { slot: string; label: string; about: string; candidates: string[] };
export type CoreItem = { slot: CoreSlot; stat: SeriesStat };

export const MIN_CORE = 3;

export const CORE_SLOTS: CoreSlot[] = [
  { slot: "life", label: "Life expectancy", about: "Average years a newborn is expected to live", candidates: ["worldbank:WDI:SP.DYN.LE00.IN", "owid:grapher:life-expectancy", "who_gho:gho:WHOSIS_000001"] },
  { slot: "jobs", label: "Unemployment", about: "Share of people looking for work who cannot find it", candidates: ["worldbank:WDI:SL.UEM.TOTL.ZS", "ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT", "unsdg:DF_SDG_GLH:SL_TLF_UEM", "eurostat:une_rt_a:PC_ACT", "bls:LN:LNS14000000", "fred:series:UNRATE"] },
  { slot: "population", label: "Population", about: "How many people live there", candidates: ["worldbank:WDI:SP.POP.TOTL", "datacommons:stat_vars:Count_Person"] },
  { slot: "income", label: "Income per person", about: "GDP per person, in US dollars", candidates: ["worldbank:WDI:NY.GDP.PCAP.CD"] },
  { slot: "prices", label: "Inflation", about: "How fast consumer prices are rising", candidates: ["worldbank:WDI:FP.CPI.TOTL.ZG", "imf:CPI:CPI._T.YOY_PCH_PA_PT", "ecb:ICP:000000.ANR"] },
  { slot: "children", label: "Child mortality", about: "Children who die before their fifth birthday", candidates: ["unsdg:DF_SDG_GLH:SH_DYN_MORT", "owid:grapher:child-mortality-igme"] },
];

const hasValue = (s: SeriesStat | undefined): s is SeriesStat => !!s && (s.points.length > 0 || !!s.multi?.headline);

/** First candidate per slot that has stored data; empty slots are skipped; fewer than MIN_CORE slots resolved gives []. */
export async function resolveCore(slots: CoreSlot[], load: (ids: string[]) => Promise<Record<string, SeriesStat>>): Promise<CoreItem[]> {
  const stats = await load([...new Set(slots.flatMap((s) => s.candidates))]);
  const items = slots.flatMap((slot) => {
    const stat = slot.candidates.map((id) => stats[id]).find(hasValue);
    return stat ? [{ slot, stat }] : [];
  });
  return items.length >= MIN_CORE ? items : [];
}
