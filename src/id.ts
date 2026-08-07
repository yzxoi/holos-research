import { ResearchFS } from "./fs";
import { getMutex, withLock } from "./lock";
import { log } from "./log";
import type { EntityPrefix, StateYaml } from "./schema";

// Use the same mutex as the state tool to prevent lost-update on state.yaml counters.
// Two concurrent ResearchId.next() calls must not interleave their read-modify-write
// of state.counters with each other or with the state tool's state.yaml writes.
const stateMutex = getMutex("state");

const COUNTER_KEY: Record<EntityPrefix, keyof StateYaml["counters"]> = {
  idea: "idea",
  plan: "plan",
  exp: "exp",
  claim: "claim",
  exh: "exh",
  paper: "paper",
  sub: "sub",
};

// Where each entity-type's YAML files live on disk.
// Used by reconcileCounter() to scan for the actual max-suffix when the
// counter and the directory drift apart.
const ENTITY_DIR: Record<EntityPrefix, string> = {
  idea: "ideas",
  plan: "plans",
  exp: "experiments",
  claim: "claims",
  exh: "exhibits",
  paper: "manuscripts",
  sub: "submissions",
};

/**
 * Scan the entity directory and return the highest numeric suffix found.
 * Files that don't match `${prefix}_NNN.yaml` are ignored.
 * Returns 0 if no files match.
 */
async function maxExistingSuffix(prefix: EntityPrefix): Promise<number> {
  const dir = ResearchFS.resolve(ENTITY_DIR[prefix]);
  const files = await ResearchFS.listYaml(dir);
  const pattern = new RegExp(`^${prefix}_(\\d+)\\.yaml$`);
  let max = 0;
  for (const f of files) {
    const m = pattern.exec(f);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (n > max) max = n;
    }
  }
  return max;
}

export namespace ResearchId {
  export async function next(prefix: EntityPrefix): Promise<string> {
    return withLock(stateMutex, async () => {
      const statePath = ResearchFS.resolve("state.yaml");
      const state = await ResearchFS.readYaml<StateYaml>(statePath);

      if (!state) {
        throw new Error("Research project not initialized. Call research_init first.");
      }

      const key = COUNTER_KEY[prefix];
      const counter = state.counters[key];

      // audit#2 P0-4 / audit#1 P0-2: reconcile against actual entity files.
      // The two writes (counter + entity .yaml) are NOT in one atomic block —
      // a crash between them strands the counter behind the actual max. If we
      // simply do `counter + 1`, the new ID collides with an existing file and
      // overwrites real research data. Scan the directory first; take whichever
      // is greater. This converges drift in a single call without manual repair.
      const actualMax = await maxExistingSuffix(prefix);
      const basis = Math.max(counter, actualMax);
      if (actualMax > counter) {
        log.warn(
          "CounterDrift",
          `${prefix}: state counter=${counter} but disk max=${actualMax}; reconciling to ${actualMax} before incrementing`,
        );
      }
      const nextVal = basis + 1;
      const id = `${prefix}_${String(nextVal).padStart(3, "0")}`;

      state.counters[key] = nextVal;
      state.updated = new Date().toISOString();
      await ResearchFS.writeYaml(statePath, state);

      return id;
    });
  }
}
