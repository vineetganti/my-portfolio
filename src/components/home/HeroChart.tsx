"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import QueueingKnee from "@/components/charts/QueueingKnee";
import { HERO_CHARTS, chartForDay, localDayNumber, type HeroChartId } from "@/lib/heroCharts";
import { DecodeMini, DtypeMini, NaiveMini, PoissonMini } from "./miniCharts";

const QUEUEING_ALT =
  "Average time in a queue as a multiple of the service time, plotted against utilization. The curve is flat at first and shoots up near full load. Use the slider or drag the marker to read any utilization.";

const VIEWS: Record<HeroChartId, ReactNode> = {
  "queueing-knee": <QueueingKnee compact alt={QUEUEING_ALT} />,
  "dtype-memory": <DtypeMini />,
  "naive-fill": <NaiveMini />,
  "decode-latency": <DecodeMini />,
  poisson: <PoissonMini />,
};

const noSubscribe = () => () => {};

/** Today's chart for the viewer's local date; `?chart=<id>` previews any of them. */
function todaysChartId(): HeroChartId {
  const asked = new URLSearchParams(window.location.search).get("chart");
  const preview = HERO_CHARTS.find((c) => c.id === asked);
  return (preview ?? chartForDay(localDayNumber())).id;
}

/**
 * A live chart from the blog that changes every day. The date is only known in the browser, so the
 * server renders an empty card of the same size and the chart fills in after hydration.
 */
export default function HeroChart() {
  const id = useSyncExternalStore(noSubscribe, todaysChartId, () => null);
  const chart = HERO_CHARTS.find((c) => c.id === id);

  return (
    <div className="hero-chart rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1">Chart of the day</p>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-heading font-extrabold text-lg tracking-tight text-ink">
          {chart ? chart.title : " "}
        </h2>
        {chart && (
          <Link
            href={chart.href}
            aria-label={`Read the post: ${chart.post}`}
            className="shrink-0 text-xs font-semibold text-ink-muted hover:text-accent transition-colors"
          >
            Read the post &rarr;
          </Link>
        )}
      </div>
      {id ? VIEWS[id] : <div className="min-h-[19rem]" aria-hidden="true" />}
    </div>
  );
}
