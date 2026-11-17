import { useRef, useState } from "react";
import { ClipboardPaste, FolderOpen, Link2, Play } from "lucide-react";
import { loadFromGitHub } from "../ingest/github";
import { entriesFromFileList, loadFromEntries } from "../ingest/localFiles";
import { PARSED_LANGUAGE_LIST } from "../parse/language";
import { errorMessage } from "../util/assert";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import type { LoadTab } from "./dialogs/LoadDialog";
import type { ProjectSource } from "./useProjectLoader";
import styles from "./Welcome.module.css";

interface WelcomeProps {
  loading: boolean;
  githubToken: string;
  onOpen: (source: ProjectSource) => Promise<void>;
  onDemo: () => void;
  onMoreOptions: (tab: LoadTab) => void;
}

export function Welcome({ loading, githubToken, onOpen, onDemo, onMoreOptions }: WelcomeProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const open = (source: ProjectSource): void => {
    setError(null);
    onOpen(source).catch((reason: unknown) => setError(errorMessage(reason)));
  };

  return (
    <main className={styles.welcome} id="canvas">
      <section className={styles.hero}>
        <div className={styles.copy}>
          <h1 className={styles.headline}>Read code as a story</h1>
          <p className={styles.lede}>
            Code is written top to bottom, but logic doesn't flow that way. VisualCode cuts each file into blocks and lays them out
            in the order they run, with an ink arrow from every call to the code it calls. Changed blocks are highlighted, so you can
            review a pull request by following the story.
          </p>

          <form
            className={styles.urlForm}
            onSubmit={(event) => {
              event.preventDefault();
              open((progress) => loadFromGitHub(url, githubToken, progress));
            }}
          >
            <TextField
              label="Public GitHub repository, folder or pull request"
              icon={Link2}
              placeholder="github.com/owner/repo/pull/42"
              value={url}
              autoFocus={window.matchMedia("(min-width: 761px)").matches /* no keyboard pop-up on phones */}
              chip={detect(url)}
              error={error}
              hint="Pull requests open with the changes highlighted."
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
            />
            <Button type="submit" variant="primary" size="lg" loading={loading} disabledReason={url.trim() === "" ? "Paste a GitHub link first" : null}>
              Open
            </Button>
          </form>

          <div className={styles.tiles}>
            <button type="button" className={styles.tile} onClick={onDemo}>
              <span className={styles.tileIcon}>
                <Play size={18} aria-hidden="true" />
              </span>
              <span className={styles.tileTitle}>Try the demo</span>
              <span className={styles.tileText}>A checkout service with one pull request to review.</span>
            </button>
            <button type="button" className={styles.tile} onClick={() => folderInput.current?.click()}>
              <span className={styles.tileIcon}>
                <FolderOpen size={18} aria-hidden="true" />
              </span>
              <span className={styles.tileTitle}>Open a folder</span>
              <span className={styles.tileText}>Pick a folder, or drop a folder or .zip anywhere. Stays on this device.</span>
            </button>
            <button type="button" className={styles.tile} onClick={() => onMoreOptions("paste")}>
              <span className={styles.tileIcon}>
                <ClipboardPaste size={18} aria-hidden="true" />
              </span>
              <span className={styles.tileTitle}>Paste code</span>
              <span className={styles.tileText}>One file, a diff, or both.</span>
            </button>
          </div>
          <input
            ref={folderInput}
            type="file"
            hidden
            // @ts-expect-error webkitdirectory is supported by all major browsers but missing from React's types
            webkitdirectory=""
            multiple
            onChange={(event) => {
              const files = event.target.files;
              if (files !== null && files.length > 0) open(async () => loadFromEntries(entriesFromFileList(files)));
              event.target.value = "";
            }}
          />
          <p className={styles.footnote}>
            Reads {PARSED_LANGUAGE_LIST}. Other code files show as whole-file blocks. Runs in your browser and works offline once installed.
          </p>
        </div>
        <StoryIllustration />
      </section>
    </main>
  );
}

/** Live label for what the typed URL points at, or nothing while it is not a GitHub link yet. */
function detect(url: string): string | null {
  const repo = String.raw`github\.com/[^/\s]+/[^/\s]+`;
  if (new RegExp(`${repo}/pull/\\d+`).test(url)) return "Pull request";
  if (new RegExp(`${repo}/(tree|blob)/[^/\\s]+/\\S+`).test(url)) return "Folder";
  if (new RegExp(`${repo}/?$`).test(url.trim())) return "Repository";
  return null;
}

/** The thesis in one picture: a story column, a branch, and ink arrows drawing from call lines. */
function StoryIllustration() {
  return (
    <svg className={styles.illustration} viewBox="0 0 420 340" aria-hidden="true">
      <g className={styles.card} style={{ animationDelay: "0ms" }}>
        <rect x="10" y="20" width="200" height="120" rx="11" className={styles.paper} />
        <rect x="10" y="20" width="200" height="34" rx="11" className={styles.head} />
        <circle cx="32" cy="37" r="10" className={styles.step} />
        <rect x="50" y="32" width="90" height="10" rx="5" className={styles.name} />
        <rect x="26" y="70" width="140" height="7" rx="3.5" className={styles.codeLine} />
        <rect x="26" y="88" width="168" height="12" rx="3" className={styles.callLine} />
        <rect x="26" y="112" width="110" height="7" rx="3.5" className={styles.codeLine} />
      </g>
      <g className={styles.card} style={{ animationDelay: "90ms" }}>
        <rect x="10" y="170" width="200" height="140" rx="11" className={styles.paper} />
        <rect x="10" y="170" width="200" height="34" rx="11" className={styles.headChanged} />
        <circle cx="32" cy="187" r="10" className={styles.step} />
        <rect x="50" y="182" width="70" height="10" rx="5" className={styles.name} />
        <rect x="26" y="220" width="150" height="7" rx="3.5" className={styles.codeLine} />
        <rect x="26" y="236" width="168" height="12" rx="3" className={styles.addedLine} />
        <rect x="26" y="258" width="168" height="12" rx="3" className={styles.callLine} />
        <rect x="26" y="282" width="96" height="7" rx="3.5" className={styles.codeLine} />
      </g>
      <g className={styles.card} style={{ animationDelay: "180ms" }}>
        <rect x="270" y="60" width="140" height="92" rx="11" className={styles.paper} />
        <rect x="270" y="60" width="140" height="34" rx="11" className={styles.head} />
        <circle cx="292" cy="77" r="10" className={styles.step} />
        <rect x="310" y="72" width="70" height="10" rx="5" className={styles.name} />
        <rect x="286" y="110" width="100" height="7" rx="3.5" className={styles.codeLine} />
        <rect x="286" y="128" width="76" height="7" rx="3.5" className={styles.codeLine} />
      </g>
      <g className={styles.card} style={{ animationDelay: "270ms" }}>
        <rect x="270" y="234" width="140" height="56" rx="11" className={styles.stub} />
        <rect x="288" y="256" width="80" height="10" rx="5" className={styles.name} />
      </g>
      <path className={styles.arrow} style={{ animationDelay: "420ms" }} d="M210 94 C 246 94, 234 77, 266 77" />
      <path className={styles.arrow} style={{ animationDelay: "560ms" }} d="M210 264 C 244 264, 236 262, 266 262" />
      <circle cx="210" cy="94" r="4" className={styles.dot} />
      <circle cx="210" cy="264" r="4" className={styles.dot} />
    </svg>
  );
}
