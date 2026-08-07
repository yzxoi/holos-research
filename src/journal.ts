import { ResearchFS } from "./fs";
import { getMutex, withLock } from "./lock";
import type { JournalNote, TimelineEvent } from "./schema";
import { ResearchTimeline } from "./timeline";

const noteMutex = getMutex("note");

export namespace ResearchJournal {
  const NOTES_FILE = "journal/research_notes.jsonl";
  // DECISIONS_FILE removed — human decisions are stored in NOTES_FILE with author: "human"
  // CONVERSATION_REFS_FILE removed — appendConversationRef was dead code

  let noteCounter = 0;
  let counterInitialized = false;
  let initPromise: Promise<void> | null = null;

  async function initCounter(): Promise<void> {
    if (counterInitialized) return;
    if (!initPromise) {
      initPromise = (async () => {
        const filePath = ResearchFS.resolve(NOTES_FILE);
        const notes = await ResearchFS.readJsonl<JournalNote>(filePath);
        let max = 0;
        for (const n of notes) {
          const m = /^note_(\d+)$/.exec(n.id);
          if (m) {
            const val = parseInt(m[1]!, 10);
            if (val > max) max = val;
          }
        }
        noteCounter = max;
        counterInitialized = true;
      })();
    }
    await initPromise;
  }

  function nextId(): string {
    noteCounter++;
    return `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  export async function appendNote(note: Omit<JournalNote, "id" | "ts">): Promise<JournalNote> {
    return withLock(noteMutex, async () => {
      await initCounter();
      const full: JournalNote = {
        id: nextId(),
        ts: new Date().toISOString(),
        ...note,
      };
      const filePath = ResearchFS.resolve(NOTES_FILE);
      await ResearchFS.appendJsonl(filePath, full);
      return full;
    });
  }

  export async function appendTimelineEvent(params: {
    event: Omit<TimelineEvent, "ts">;
    note?: Omit<JournalNote, "id" | "ts" | "author" | "kind">;
  }): Promise<{ event: TimelineEvent; note?: JournalNote }> {
    // Use a single timestamp for both the timeline event and the return value
    const ts = new Date().toISOString();
    const event: TimelineEvent = {
      ts,
      ...params.event,
    };
    await ResearchTimeline.append(event);
    let note: JournalNote | undefined;
    if (params.note) {
      note = await appendNote({
        author: "agent",
        kind: "handoff",
        ...params.note,
        source_event: event.id ?? event.type,
      });
    }
    return { event, note };
  }

  export async function appendHumanDecision(params: {
    phase?: JournalNote["phase"];
    phase_run_ref?: string;
    kind: JournalNote["kind"];
    refs?: string[];
    summary: string;
    note: string;
    source_event?: string;
  }): Promise<JournalNote> {
    return appendNote({
      author: "human",
      phase: params.phase,
      phase_run_ref: params.phase_run_ref,
      kind: params.kind,
      importance: "critical",
      refs: params.refs ?? [],
      summary: params.summary,
      note: params.note,
      source_event: params.source_event,
    });
  }

  export async function appendAgentNote(params: {
    phase?: JournalNote["phase"];
    phase_run_ref?: string;
    kind: JournalNote["kind"];
    refs?: string[];
    summary: string;
    note: string;
    importance?: JournalNote["importance"];
    source_event?: string;
  }): Promise<JournalNote> {
    return appendNote({
      author: "agent",
      phase: params.phase,
      phase_run_ref: params.phase_run_ref,
      kind: params.kind,
      importance: params.importance ?? "normal",
      refs: params.refs ?? [],
      summary: params.summary,
      note: params.note,
      source_event: params.source_event,
    });
  }

  export async function queryNotes(opts?: {
    phase?: string;
    phase_run_ref?: string;
    kind?: JournalNote["kind"];
    importance?: JournalNote["importance"];
    refs?: string[];
    last?: number;
  }): Promise<JournalNote[]> {
    const filePath = ResearchFS.resolve(NOTES_FILE);
    let notes = await ResearchFS.readJsonl<JournalNote>(filePath);

    if (opts?.phase) {
      notes = notes.filter((n) => n.phase === opts.phase);
    }
    if (opts?.phase_run_ref) {
      notes = notes.filter((n) => n.phase_run_ref === opts.phase_run_ref);
    }
    if (opts?.kind) {
      notes = notes.filter((n) => n.kind === opts.kind);
    }
    if (opts?.importance) {
      notes = notes.filter((n) => n.importance === opts.importance);
    }
    if (opts?.refs && opts.refs.length > 0) {
      notes = notes.filter((n) => opts.refs!.some((r) => n.refs.includes(r)));
    }
    if (opts?.last) {
      notes = notes.slice(-opts.last);
    }

    return notes;
  }

  export async function queryHumanDecisions(opts?: {
    phase?: string;
    phase_run_ref?: string;
    last?: number;
  }): Promise<JournalNote[]> {
    // Human decisions are written to NOTES_FILE with author: "human"
    const filePath = ResearchFS.resolve(NOTES_FILE);
    const notes = await ResearchFS.readJsonl<JournalNote>(filePath);
    let decisions = notes.filter((n) => n.author === "human");

    if (opts?.phase) {
      decisions = decisions.filter((d) => d.phase === opts.phase);
    }
    if (opts?.phase_run_ref) {
      decisions = decisions.filter((d) => d.phase_run_ref === opts.phase_run_ref);
    }
    if (opts?.last) {
      decisions = decisions.slice(-opts.last);
    }

    return decisions;
  }
}
