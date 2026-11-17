import { useMemo, useState } from "react";
import { Copy, Download } from "lucide-react";
import { downloadText } from "../../review/reviewStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { useToast } from "../../ui/Toasts";
import { TECHNOLOGIES } from "../../system/catalog";
import { toMermaid, toStructurizr } from "../../system/export";
import { KIND_LABEL, type ComponentKind, type SystemDesign } from "../../system/model";
import { KIND_ICON } from "./SystemNode";
import styles from "./SystemCanvas.module.css";

export interface CatalogChoice {
  name: string;
  kind: ComponentKind;
  technology: string | null;
}

const PARTS: CatalogChoice[] = [
  { name: "service", kind: "service", technology: null },
  { name: "frontend", kind: "frontend", technology: null },
  { name: "worker", kind: "worker", technology: null },
  { name: "external API", kind: "external", technology: null },
];

/** The catalog: generic parts, and data stores and brokers that come with an integration guide. */
export function AddComponentDialog({ onAdd, onClose }: { onAdd: (choice: CatalogChoice) => void; onClose: () => void }) {
  const guided = TECHNOLOGIES.filter((technology) => technology.guide !== null);
  return (
    <Dialog title="Add component" description="Data stores and brokers come with a step-by-step guide for adding them to the code." onClose={onClose}>
      <section className={styles.catalogGroup} aria-label="Data and messaging">
        <span className="label">Data and messaging · with a guide</span>
        <div className={styles.catalog}>
          {guided.map((technology) => (
            <CatalogButton key={technology.id} kind={technology.kind} title={technology.label} subtitle={KIND_LABEL[technology.kind]} onClick={() => onAdd({ name: technology.id, kind: technology.kind, technology: technology.id })} />
          ))}
        </div>
      </section>
      <section className={styles.catalogGroup} aria-label="Apps and services">
        <span className="label">Apps and services</span>
        <div className={styles.catalog}>
          {PARTS.map((part) => (
            <CatalogButton key={part.kind} kind={part.kind} title={KIND_LABEL[part.kind]} subtitle="Name it after adding" onClick={() => onAdd(part)} />
          ))}
        </div>
      </section>
    </Dialog>
  );
}

function CatalogButton({ kind, title, subtitle, onClick }: { kind: ComponentKind; title: string; subtitle: string; onClick: () => void }) {
  const Icon = KIND_ICON[kind];
  return (
    <button type="button" className={styles.catalogItem} onClick={onClick}>
      <span className={styles.nodeIcon} aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className={styles.nodeText}>
        <span className={styles.nodeName}>{title}</span>
        <span className={styles.nodeMeta}>{subtitle}</span>
      </span>
    </button>
  );
}

type ExportFormat = "mermaid" | "structurizr";

const FORMATS: Record<ExportFormat, { label: string; extension: string; mime: string; hint: string }> = {
  mermaid: { label: "Mermaid", extension: "mmd", mime: "text/plain", hint: "Paste into Markdown on GitHub, GitLab or Notion inside a ```mermaid block." },
  structurizr: { label: "Structurizr DSL", extension: "dsl", mime: "text/plain", hint: "A C4 container view. Open it in Structurizr Lite or the online DSL editor." },
};

/** The design as Mermaid or Structurizr DSL, to copy or download. */
export function ExportSystemDialog({ design, projectName, onClose }: { design: SystemDesign; projectName: string; onClose: () => void }) {
  const toast = useToast();
  const [format, setFormat] = useState<ExportFormat>("mermaid");
  const text = useMemo(() => (format === "mermaid" ? toMermaid(design) : toStructurizr(design, projectName)), [format, design, projectName]);
  const info = FORMATS[format];
  const fileBase = projectName.replace(/[^\w.-]+/g, "-");
  const copy = (): void => {
    navigator.clipboard.writeText(text).then(
      () => toast({ message: `${info.label} copied`, tone: "success" }),
      () => toast({ message: "Copying was blocked by the browser. Use Download instead.", tone: "error" }),
    );
  };
  return (
    <Dialog title="Export system design" description={`${design.components.length} components · ${design.connections.length} connections`} width="wide" onClose={onClose}>
      <SegmentedControl<ExportFormat>
        label="Format"
        value={format}
        onChange={setFormat}
        segments={(Object.keys(FORMATS) as ExportFormat[]).map((value) => ({ value, label: FORMATS[value].label }))}
      />
      <p className="caption">{info.hint}</p>
      <pre className={styles.exportPreview}>{text}</pre>
      <div className={styles.panelActions}>
        <Button variant="primary" icon={Copy} onClick={copy}>
          Copy
        </Button>
        <Button icon={Download} onClick={() => downloadText(`${fileBase}.system.${info.extension}`, text, info.mime)}>
          Download .{info.extension}
        </Button>
      </div>
    </Dialog>
  );
}
