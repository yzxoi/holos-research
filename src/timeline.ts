import { ResearchFS } from "./fs";
import type { TimelineEvent } from "./schema";

export namespace ResearchTimeline {
  const FILE = "timeline.jsonl";

  export async function append(event: Omit<TimelineEvent, "ts">): Promise<void> {
    const filePath = ResearchFS.resolve(FILE);
    const full: TimelineEvent = {
      ts: new Date().toISOString(),
      ...event,
    };
    await ResearchFS.appendJsonl(filePath, full);
  }

  export interface QueryOptions {
    since?: string;
    type?: string;
    refs?: string[];
    last?: number;
  }

  export async function query(opts?: QueryOptions): Promise<TimelineEvent[]> {
    const filePath = ResearchFS.resolve(FILE);
    let events = await ResearchFS.readJsonl<TimelineEvent>(filePath);

    if (opts?.since) {
      events = events.filter((e) => e.ts >= opts.since!);
    }

    if (opts?.type) {
      // Escape regex metacharacters to prevent injection
      const escaped = opts.type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`^${escaped}$`);
      events = events.filter((e) => re.test(e.type));
    }

    if (opts?.refs && opts.refs.length > 0) {
      const refSet = new Set(opts.refs);
      events = events.filter((e) => {
        const eRefs = e.refs ?? (e.id ? [e.id] : []);
        return eRefs.some((r) => refSet.has(r));
      });
    }

    // audit-self H1: apply `last` AFTER all filters. The previous code did an
    // early `slice(-last*3)` BEFORE filtering, which silently truncated results
    // when filtering by type/refs (e.g. query({last:10, type:"X"}) could miss
    // matching events further back in the tail).
    if (opts?.last) {
      events = events.slice(-opts.last);
    }

    return events;
  }
}
