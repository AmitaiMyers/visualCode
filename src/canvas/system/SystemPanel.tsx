import { useMemo, useState } from "react";
import { ArrowRight, Copy, KeyRound, Sparkles, Trash2, X } from "lucide-react";
import { sendToClaude } from "../../ai/claude";
import { useAiConsent } from "../../privacy/AiConsent";
import { fileId } from "../../model/ids";
import { useAnalysis, useNavigation } from "../../state/workspace";
import { errorMessage } from "../../util/assert";
import { Button, IconButton } from "../../ui/Button";
import { useToast } from "../../ui/Toasts";
import { PLAN_LANGUAGE_LABEL, technologyById, isTechnologyId, type PlanLanguage } from "../../system/catalog";
import { KIND_LABEL, type Evidence, type SystemComponent, type SystemConnection, type SystemDesign } from "../../system/model";
import { appLanguages, buildIntegrationPlan, draftRequest, type IntegrationPlan, type TouchPoint } from "../../system/plan";
import { blockAtLine } from "../../graph/blocks";
import { technologyName } from "./SystemNode";
import styles from "./SystemCanvas.module.css";

interface SystemPanelProps {
  design: SystemDesign;
  selectedId: string;
  aiKey: string;
  onAddApiKey: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onClose: () => void;
}

/** Details of the selected component or connection: what it is, where the code shows it, and how to add it. */
export function SystemPanel({ design, selectedId, aiKey, onAddApiKey, onRemove, onRename, onClose }: SystemPanelProps) {
  const item: SystemComponent | SystemConnection | undefined = design.components.find((candidate) => candidate.id === selectedId) ?? design.connections.find((candidate) => candidate.id === selectedId);
  if (item === undefined) throw new Error(`Selected item is not in the design: ${selectedId}`);
  const component = isComponent(item) ? item : null;
  const nameOf = (id: string): string => design.components.find((candidate) => candidate.id === id)?.name ?? id;
  const title = isComponent(item) ? item.name : `${nameOf(item.from)} → ${nameOf(item.to)}`;
  const subtitle = isComponent(item) ? [KIND_LABEL[item.kind], technologyName(item)].filter((part) => part !== null).join(" · ") : item.label;

  return (
    <aside className={styles.panel} aria-label="System details">
      <header className={styles.panelHead}>
        <div className={styles.panelTitleRow}>
          {component !== null && component.origin === "added" ? (
            <input className={styles.nameInput} aria-label="Name" value={component.name} onChange={(event) => onRename(component.id, event.target.value)} />
          ) : (
            <h2 className={styles.panelTitle}>{title}</h2>
          )}
          <IconButton icon={X} label="Close details" onClick={onClose} />
        </div>
        <p className="caption">
          {subtitle}
          {item.origin === "added" ? " · added by you" : " · detected"}
        </p>
        <div className={styles.panelActions}>
          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onRemove(item.id)} className="edit-only">
            Remove
          </Button>
        </div>
      </header>
      <div className={styles.panelBody}>
        {item.evidence.length > 0 && <EvidenceList evidence={item.evidence} />}
        {component !== null && isTechnologyId(component.technology) && technologyById(component.technology).guide !== null && (
          <IntegrationGuide key={component.id} design={design} component={component} aiKey={aiKey} onAddApiKey={onAddApiKey} />
        )}
        {component !== null && component.origin === "added" && !isTechnologyId(component.technology) && (
          <p className="caption">Drag from the dot on its right edge to another component to show what it talks to.</p>
        )}
      </div>
    </aside>
  );
}

function isComponent(item: SystemComponent | SystemConnection): item is SystemComponent {
  return "kind" in item;
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  const analysis = useAnalysis();
  const navigation = useNavigation();
  const open = (entry: Evidence): void => {
    const block = entry.line === null ? null : blockAtLine(analysis.graph, entry.path, entry.line);
    navigation.open(block === null ? fileId(entry.path) : block.id);
  };
  return (
    <section className={styles.panelSection} aria-label="Where the code shows it">
      <span className="label">Where the code shows it</span>
      <ul className={styles.evidenceList}>
        {evidence.map((entry) => (
          <li key={`${entry.path}:${entry.line ?? ""}`}>
            <button
              type="button"
              className={styles.evidenceLink}
              onClick={() => open(entry)}
              disabled={!analysis.graph.nodes.has(fileId(entry.path))}
              title={analysis.graph.nodes.has(fileId(entry.path)) ? "Open in the storyline" : "This file is not loaded"}
            >
              <span className={styles.evidencePath}>
                {entry.path}
                {entry.line !== null && `:${entry.line}`}
              </span>
              <span className="caption">{entry.note}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The guided plan for adding a technology to one of the project's apps, plus an optional Claude draft. */
function IntegrationGuide({ design, component, aiKey, onAddApiKey }: { design: SystemDesign; component: SystemComponent; aiKey: string; onAddApiKey: () => void }) {
  const analysis = useAnalysis();
  const toast = useToast();
  const apps = design.components.filter((candidate) => candidate.rootPath !== null && candidate.kind !== "frontend");
  const connected = apps.find((app) => design.connections.some((connection) => connection.from === app.id && connection.to === component.id));
  const [appId, setAppId] = useState<string | null>(connected?.id ?? apps[0]?.id ?? null);
  const app = apps.find((candidate) => candidate.id === appId) ?? null;
  const detected = app === null ? [] : appLanguages(analysis, app);
  const [language, setLanguage] = useState<PlanLanguage | null>(null);
  const planLanguage = language ?? detected[0] ?? "ts";
  const plan = useMemo(() => (app === null || component.technology === null ? null : buildIntegrationPlan(analysis, design, component.technology, app, planLanguage)), [analysis, design, component, app, planLanguage]);
  const [draft, setDraft] = useState<DraftState>({ status: "idle" });
  const { confirmSend, consentDialog } = useAiConsent();

  if (apps.length === 0 || app === null || plan === null) {
    return <p className="caption">Add a service built from this project's code to get an integration guide.</p>;
  }

  const copy = (text: string, what: string): void => {
    navigator.clipboard.writeText(text).then(
      () => toast({ message: `${what} copied`, tone: "success" }),
      () => toast({ message: "Copying was blocked by the browser.", tone: "error" }),
    );
  };
  const askForDraft = async (): Promise<void> => {
    const request = draftRequest(analysis, plan);
    if (!(await confirmSend(request))) return;
    setDraft({ status: "loading" });
    sendToClaude(aiKey, request)
      .then((text) => setDraft({ status: "done", text }))
      .catch((reason: unknown) => setDraft({ status: "error", message: errorMessage(reason) }));
  };

  return (
    <section className={styles.panelSection} aria-label="Integration guide">
      {consentDialog}
      <span className="label">Add {plan.technology.label} to the code</span>
      <div className={styles.planPickers}>
        <label className={styles.picker}>
          <span className="caption">App</span>
          <select value={app.id} onChange={(event) => setAppId(event.target.value)}>
            {apps.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.picker}>
          <span className="caption">Language</span>
          <select value={planLanguage} onChange={(event) => setLanguage(event.target.value as PlanLanguage)}>
            {(Object.keys(PLAN_LANGUAGE_LABEL) as PlanLanguage[]).map((candidate) => (
              <option key={candidate} value={candidate}>
                {PLAN_LANGUAGE_LABEL[candidate]}
                {detected.includes(candidate) ? "" : " (not used in this app)"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ol className={styles.steps}>
        {plan.steps.map((step) => (
          <li key={step.title} className={styles.step}>
            <strong>{step.title}</strong>
            <p className={styles.stepDetail}>{step.detail}</p>
            {step.snippets.map((snippet) => (
              <div key={`${snippet.file}:${snippet.text.slice(0, 24)}`} className={styles.snippet}>
                <div className={styles.snippetHead}>
                  <span className={styles.evidencePath}>{snippet.file === "" ? "project root" : snippet.file}</span>
                  <IconButton icon={Copy} label="Copy" onClick={() => copy(snippet.text, "Snippet")} />
                </div>
                <pre className={styles.snippetCode}>{snippet.text}</pre>
              </div>
            ))}
            {step.touchPoints.length > 0 && <TouchPoints points={step.touchPoints} />}
            {step.title === "Use it in the code" && step.touchPoints.length === 0 && <p className="caption">No existing blocks to change were found; start from the new client module.</p>}
          </li>
        ))}
      </ol>
      <ClaudeDraft draft={draft} aiKey={aiKey} onAsk={() => void askForDraft()} onAddApiKey={onAddApiKey} onCopy={(text) => copy(text, "Draft")} plan={plan} />
    </section>
  );
}

function TouchPoints({ points }: { points: TouchPoint[] }) {
  const navigation = useNavigation();
  return (
    <ul className={styles.evidenceList}>
      {points.map((point) => (
        <li key={point.nodeId}>
          <button type="button" className={styles.evidenceLink} onClick={() => navigation.open(point.nodeId)} title="Open in the storyline">
            <span className={styles.touchName}>
              <ArrowRight size={12} aria-hidden="true" /> {point.label}
            </span>
            <span className="caption">
              {point.path}:{point.line} · {point.reason}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type DraftState = { status: "idle" } | { status: "loading" } | { status: "done"; text: string } | { status: "error"; message: string };

function ClaudeDraft({ draft, aiKey, plan, onAsk, onAddApiKey, onCopy }: { draft: DraftState; aiKey: string; plan: IntegrationPlan; onAsk: () => void; onAddApiKey: () => void; onCopy: (text: string) => void }) {
  const noKey = aiKey === "" ? "Add a Claude API key in Settings" : null;
  return (
    <div className={styles.draft}>
      <span className="label">Optional · draft with Claude</span>
      <p className="caption">
        Sends this plan and the {plan.steps.flatMap((step) => step.touchPoints).length} blocks above to Claude, which drafts the changed code for you to review.
      </p>
      <div className={styles.panelActions}>
        <Button size="sm" icon={Sparkles} loading={draft.status === "loading"} disabledReason={noKey} onClick={onAsk}>
          {draft.status === "done" ? "Draft again" : "Draft the changes"}
        </Button>
        {noKey !== null && (
          <Button size="sm" variant="ghost" icon={KeyRound} onClick={onAddApiKey}>
            Add key
          </Button>
        )}
        {draft.status === "done" && (
          <Button size="sm" variant="ghost" icon={Copy} onClick={() => onCopy(draft.text)}>
            Copy draft
          </Button>
        )}
      </div>
      {draft.status === "error" && (
        <p className={styles.error} role="alert">
          {draft.message}
        </p>
      )}
      {draft.status === "done" && <pre className={styles.snippetCode}>{draft.text}</pre>}
    </div>
  );
}
