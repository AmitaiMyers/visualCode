import { useCallback, useRef, useState, type ReactNode } from "react";
import { get, set } from "idb-keyval";
import { Send } from "lucide-react";
import type { AiRequest } from "../ai/claude";
import { useAnalysis } from "../state/workspace";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { PROJECT_KEYS } from "./localData";
import styles from "../app/dialogs/dialogs.module.css";

interface Pending {
  request: AiRequest;
  resolve: (send: boolean) => void;
}

/**
 * Asks before project code goes to Claude, showing what the request contains. "Don't ask again" is
 * remembered per project in this browser (cleared with the project's data).
 */
export function useAiConsent(): { confirmSend: (request: AiRequest) => Promise<boolean>; consentDialog: ReactNode } {
  const analysis = useAnalysis();
  const projectId = analysis.project.id;
  const [pending, setPending] = useState<Pending | null>(null);

  const confirmSend = useCallback(
    async (request: AiRequest): Promise<boolean> => {
      const granted = await get<boolean>(PROJECT_KEYS.aiConsent(projectId));
      if (granted === true) return true;
      return new Promise<boolean>((resolve) => setPending({ request, resolve }));
    },
    [projectId],
  );

  const finish = (send: boolean, remember: boolean): void => {
    if (pending === null) throw new Error("No AI request is waiting for consent");
    pending.resolve(send);
    setPending(null);
    if (send && remember) void set(PROJECT_KEYS.aiConsent(projectId), true);
  };

  const consentDialog = pending === null ? null : <ConsentDialog request={pending.request} projectTitle={analysis.project.title} onAnswer={finish} />;
  return { confirmSend, consentDialog };
}

function ConsentDialog({ request, projectTitle, onAnswer }: { request: AiRequest; projectTitle: string; onAnswer: (send: boolean, remember: boolean) => void }) {
  const [remember, setRemember] = useState(false);
  const answered = useRef(false);
  const answer = (send: boolean): void => {
    if (answered.current) return; // closing the dialog after "Send" must not also count as "Cancel"
    answered.current = true;
    onAnswer(send, remember);
  };
  const lines = request.prompt.split("\n").length;
  return (
    <Dialog title="Send code to Claude?" description="From your browser to api.anthropic.com, with your API key. Nothing else leaves this page." onClose={() => answer(false)}>
      <section className={styles.group} aria-label="What will be sent">
        <span className="label">What will be sent</span>
        <ul className={styles.plainList}>
          {request.includes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="caption">
          {lines} lines · {request.prompt.length.toLocaleString()} characters, with instructions for Claude.
        </p>
      </section>
      <label className={styles.switch}>
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        <span className={styles.switchText}>
          <span className={styles.switchTitle}>Don't ask again for {projectTitle}</span>
          <span className="caption">Until you clear this project's data in Settings.</span>
        </span>
      </label>
      <div className={styles.row}>
        <Button variant="primary" icon={Send} onClick={() => answer(true)}>
          Send to Claude
        </Button>
        <Button variant="ghost" onClick={() => answer(false)}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
