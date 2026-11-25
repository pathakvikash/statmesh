import { Suspense } from "react";
import Link from "next/link";
import { CoreIndicators } from "@/components/CoreIndicators";
import { HomeGraph } from "@/components/graph/HomeGraph";
import { Featured, LatestUpdates, SectionSkeleton, SourceCount, SourcesSummary } from "@/components/home/HomeSections";
import { LegacyRedirect } from "@/components/home/LegacyRedirect";
import { SearchForm } from "@/components/SearchForm";
import { EXAMPLES, searchHref } from "@/lib/params";
import { card, chip } from "@/lib/ui";

// ISR: the shell prerenders (no searchParams/cookies/headers read here); each slow section streams in its own Suspense.
export const revalidate = 300;
export const maxDuration = 60; // seconds: the free API host wakes slowly and the stats queries take a few seconds

export default function Page() {
  return (
    <div className="space-y-14">
      <Suspense fallback={null}><LegacyRedirect /></Suspense>
      <section className="mx-auto max-w-3xl pt-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Ask anything about the world&rsquo;s statistics</h1>
        <p className="mt-3 text-muted-foreground">Describe the data you need in plain words. We search <Suspense fallback="dozens of"><SourceCount /></Suspense> official sources and cite every number.</p>
        <div className="mt-6 text-left"><SearchForm big /></div>
        <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Example questions">
          {EXAMPLES.map((e) => <Link key={e} href={searchHref({ q: e })} className={chip}>{e}</Link>)}
        </div>
      </section>

      <CoreIndicators fallback={<SectionSkeleton className="h-72" />} />
      <Suspense fallback={<SectionSkeleton className="h-[560px]" />}><HomeGraph /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><LatestUpdates /></Suspense>
      <Suspense fallback={<SectionSkeleton className="h-80" />}><Featured /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><SourcesSummary /></Suspense>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <Link href="/sql" className={`${card} p-4 transition-shadow hover:shadow-md`}>
          <div className="font-medium">SQL console</div>
          <div className="text-sm text-muted-foreground">Query every observation directly with read-only SQL.</div>
        </Link>
        <Link href="/chat" className={`${card} p-4 transition-shadow hover:shadow-md`}>
          <div className="font-medium">Ask the AI with your own key</div>
          <div className="text-sm text-muted-foreground">Chat over the data with cited answers and charts.</div>
        </Link>
      </section>
    </div>
  );
}
