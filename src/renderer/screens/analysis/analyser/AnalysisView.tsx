// One analysis: steps, example choice, the gauge with its time band, questions, cost, the Analyste chat, and the exits.
import { Check, Circle, Loader2 } from "lucide-react";
import { useState } from "react";
import { t } from "../../../../shared/fr";
import type { AnalysisDetail } from "../../../../shared/analysis";
import {
  BUDGET_MODE_IDS,
  type GaugeMode,
  type InputId,
} from "../../../../shared/gauge";
import {
  ErrorLine,
  ExampleBadge,
  LoadingBlock,
  fmtInt,
} from "@/components/atelier/kit";
import { DemoBoundary } from "@/components/atelier/demo";
import { Panel } from "@/components/atelier/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { call, errText, useLoader } from "@/state/client";
import { CostBlock } from "../shared/common";
import { PipelineGraph } from "../shared/PipelineGraph";
import { ActionsPanel } from "./ActionsPanel";
import { AnalystChat } from "./AnalystChat";
import { clock } from "./band";
import { GaugePanel, InputsPanel } from "./GaugePanel";
import { ExampleVideoBand } from "./TimeBand";

export function AnalysisView({
  id,
  onPipelines,
}: {
  id: number;
  onPipelines: () => void;
}) {
  const loaded = useLoader(() => call("analysis.get", id), `analysis-${id}`, [
    "analysis",
    "example",
  ]);
  if (loaded.error)
    return <ErrorLine message={loaded.error} onRetry={loaded.reload} />;
  if (!loaded.data) return <LoadingBlock rows={5} />;
  return (
    <AnalysisBody
      detail={loaded.data}
      reload={loaded.reload}
      onPipelines={onPipelines}
    />
  );
}

function Steps({ detail }: { detail: AnalysisDetail }) {
  return (
    <ol
      className="flex flex-wrap gap-x-5 gap-y-2"
      data-testid="analysis-steps"
      aria-label={t("analysis.steps.title")}
    >
      {detail.steps.map((s) => (
        <li
          key={s.id}
          data-status={s.status}
          className={cn(
            "inline-flex items-center gap-1.5 text-[12.5px]",
            s.status === "pending" ? "text-fg-3" : "text-fg-2",
          )}
        >
          {s.status === "done" ? (
            <Check className="size-3.5 text-ok" aria-hidden />
          ) : s.status === "waiting" ? (
            <Loader2 className="size-3.5 animate-spin text-warn" aria-hidden />
          ) : (
            <Circle className="size-3.5" aria-hidden />
          )}
          {s.status === "done"
            ? t(`analysis.step.${s.id}.done`, { n: s.n })
            : t(`analysis.step.${s.id}`)}
        </li>
      ))}
    </ol>
  );
}

function ExamplePicker({
  detail,
  onChosen,
}: {
  detail: AnalysisDetail;
  onChosen: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>(
    detail.chosenExamples.length > 0
      ? detail.chosenExamples
      : detail.reference.proposedExamples,
  );
  const [busy, setBusy] = useState(false);
  const toggle = (vid: string) =>
    setChosen((c) =>
      c.includes(vid) ? c.filter((x) => x !== vid) : [...c, vid],
    );
  const go = async () => {
    setBusy(true);
    try {
      await call("analysis.chooseExamples", detail.id, chosen);
      onChosen();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t("analysis.examples.title")} data-testid="example-picker">
      <p className="mb-3 text-[12.5px] text-fg-3">
        {t("analysis.examples.blurb")}
      </p>
      <ul className="flex flex-col gap-2">
        {detail.reference.recentVideos.map((v) => (
          <li key={v.id}>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-field border px-3 py-2 text-[13px]",
                chosen.includes(v.id)
                  ? "border-brand/60 bg-brand-soft"
                  : "border-line bg-surface-2 hover:bg-surface-pop",
              )}
            >
              <input
                type="checkbox"
                className="accent-[var(--brand)]"
                checked={chosen.includes(v.id)}
                onChange={() => toggle(v.id)}
              />
              <span className="min-w-0 flex-1 truncate text-fg">{v.title}</span>
              {v.outlier && (
                <span className="rounded-full border border-ok/40 px-1.5 text-[10px] text-ok">
                  {t("analysis.examples.outlier")}
                </span>
              )}
              <span className="text-[11.5px] text-fg-3">
                {t("analysis.video.facts", {
                  views: fmtInt(v.views),
                  duration: clock(v.durationS),
                  days: v.publishedDaysAgo,
                })}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="brand"
          data-testid="analyse-examples"
          disabled={busy || chosen.length === 0}
          onClick={() => void go()}
        >
          {busy
            ? t("analysis.examples.busy")
            : t("analysis.examples.go", { n: chosen.length })}
        </Button>
        <span className="text-[11.5px] text-fg-3">
          {t("analysis.examples.hint")}
        </span>
      </div>
    </Panel>
  );
}

export function AnalysisBody({
  detail,
  reload,
  onPipelines,
}: {
  detail: AnalysisDetail;
  reload: () => void;
  onPipelines: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [delta, setDelta] = useState<{ from: number; to: number } | null>(null);
  const ref = detail.reference;

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      toast.error(errText(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const answer = async (input: InputId, value: boolean | null) => {
    const before = detail.gauge?.score ?? null;
    const next = await run(() =>
      call("analysis.answer", detail.id, input, value),
    );
    if (next?.gauge && before !== null)
      setDelta({ from: before, to: next.gauge.score });
    reload();
  };
  const setMode = async (mode: GaugeMode) => {
    await run(() => call("analysis.setMode", detail.id, mode));
    setDelta(null);
    reload();
  };
  const state = {
    mode: detail.mode,
    answers: detail.answers,
    replace: detail.replace,
  };
  const profile = detail.profile;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="analysis-view">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-serif text-[30px] leading-none">
              {detail.channelName}
            </h2>
            {detail.example && <ExampleBadge />}
            <Badge variant="warn" data-testid="invented-reference">
              {t("analysis.reference.invented")}
            </Badge>
          </div>
          <p className="mt-1.5 text-[13px] text-fg-3">
            {ref.niche} · {ref.format} ·{" "}
            {t("analysis.channel.facts", {
              subs: fmtInt(ref.subscribers),
              n: ref.uploadsPerWeek,
            })}
          </p>
        </div>
        {detail.status === "done" && (
          <div
            role="radiogroup"
            aria-label={t("analysis.mode.label")}
            className="inline-flex rounded-full border border-line-2 bg-surface-1 p-0.5"
          >
            {BUDGET_MODE_IDS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={detail.mode === m}
                disabled={busy}
                data-testid={`mode-${m}`}
                onClick={() => void setMode(m)}
                className={cn(
                  "rounded-full px-3.5 py-1 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60",
                  detail.mode === m
                    ? "bg-brand text-ink-fg"
                    : "text-fg-2 hover:text-fg",
                )}
              >
                {t(`analysis.mode.${m}`)}
              </button>
            ))}
          </div>
        )}
      </header>

      <DemoBoundary feature="youtube-research">
        <Steps detail={detail} />

        {detail.status === "choose_examples" && (
          <ExamplePicker detail={detail} onChosen={reload} />
        )}

        {detail.status === "done" && detail.gauge && (
          <>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <GaugePanel gauge={detail.gauge} delta={delta} />
              <div className="flex flex-col gap-5">
                <InputsPanel
                  detail={detail}
                  busy={busy}
                  onAnswer={(i, v) => void answer(i, v)}
                />
                {detail.cost && (
                  <Panel title={t("analysis.cost.title")}>
                    <CostBlock
                      minutes={detail.cost.minutes}
                      modes={detail.cost.modes}
                    />
                  </Panel>
                )}
              </div>
            </div>

            <section
              aria-label={t("analysis.videos.title")}
              className="flex flex-col gap-3"
            >
              <h3 className="micro-label">{t("analysis.videos.title")}</h3>
              {detail.examples.map((e) => (
                <ExampleVideoBand
                  key={e.video.id}
                  video={e.video}
                  segments={e.segments}
                  state={state}
                />
              ))}
            </section>

            {profile && (
              <Panel
                title={t("analysis.profile.title")}
                data-testid="analysis-profile"
              >
                <p className="mb-3 text-[13px] text-fg-2">{profile.summary}</p>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12.5px] md:grid-cols-2">
                  {(
                    [
                      ["analysis.notes.voice", profile.notes.voiceWhy],
                      ["analysis.notes.script", profile.notes.scriptWhy],
                      ["analysis.notes.edit", profile.notes.editWhy],
                    ] as const
                  ).map(([k, why]) => (
                    <div key={k}>
                      <dt className="micro-label">{t(k)}</dt>
                      <dd className="text-fg-2">{why}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="micro-label">
                      {t("analysis.profile.cuts")}
                    </dt>
                    <dd className="text-fg-2">
                      {t("analysis.profile.cutsValue", {
                        n: profile.cutsPerMinute,
                      })}
                    </dd>
                  </div>
                </dl>
              </Panel>
            )}

            {detail.proposedPipelineJson && (
              <Panel
                title={t("analysis.pipeline.title")}
                data-testid="analysis-pipeline-preview"
              >
                <PipelineGraph json={detail.proposedPipelineJson} />
              </Panel>
            )}

            <AnalystChat
              detail={detail}
              onDone={(before) => {
                reload();
                if (before !== null) setDelta(null);
              }}
            />
            <ActionsPanel detail={detail} onPipelineCreated={onPipelines} />
          </>
        )}
      </DemoBoundary>
    </div>
  );
}
