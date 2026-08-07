import { ResearchFS } from "./fs";
import { getMutex, withLock } from "./lock";
import type { StorySpine } from "./schema";

const storyMutex = getMutex("story");

export namespace StoryManager {
  const DIR = "positioning";

  export function resolvePath(id: string): string {
    return ResearchFS.resolve(DIR, `${id}.story.yaml`);
  }

  export async function create(params: {
    id?: string;
    idea_ref: string;
    field_assumption: string;
    pain_point: string;
    non_obvious_insight: string;
    what_changes_if_true: string;
    why_now?: string;
    beneficiaries?: string[];
    candidate_paper_angles?: StorySpine["candidate_paper_angles"];
    story_risks?: string[];
    scores?: Record<string, number>;
    grounded_angle?: StorySpine["grounded_angle"];
    closest_work_positioning?: Record<string, string>[];
    expected_main_claims?: string[];
    minimum_evidence?: string[];
    fallback_paths?: Record<string, string>[];
    reframe_history?: { from_type: string; to_type: string; rationale: string }[];
  }): Promise<StorySpine> {
    return withLock(storyMutex, async () => {
      const id = params.id ?? `story_${Date.now()}`;
      const _now = new Date().toISOString();

      const story: StorySpine = {
        id,
        idea_ref: params.idea_ref,
        version: 1,
        status: "proposed",
        field_assumption: params.field_assumption,
        pain_point: params.pain_point,
        non_obvious_insight: params.non_obvious_insight,
        why_now: params.why_now,
        what_changes_if_true: params.what_changes_if_true,
        beneficiaries: params.beneficiaries ?? [],
        candidate_paper_angles: params.candidate_paper_angles ?? [],
        story_risks: params.story_risks ?? [],
        scores: params.scores ?? {},
        grounded_angle: params.grounded_angle,
        closest_work_positioning: params.closest_work_positioning ?? [],
        expected_main_claims: params.expected_main_claims ?? [],
        minimum_evidence: params.minimum_evidence ?? [],
        fallback_paths: params.fallback_paths ?? [],
        reframe_history: params.reframe_history ?? [],
        claim_refs: [],
      };

      await ResearchFS.writeYaml(resolvePath(id), story);
      return story;
    });
  }

  export async function read(id: string): Promise<StorySpine | undefined> {
    return ResearchFS.readYaml<StorySpine>(resolvePath(id));
  }

  export async function update(
    id: string,
    patch: Partial<Omit<StorySpine, "id" | "version">>,
  ): Promise<StorySpine | undefined> {
    return withLock(storyMutex, async () => {
      const story = await read(id);
      if (!story) return undefined;

      const updated: StorySpine = {
        ...story,
        ...patch,
        id: story.id,
        version: story.version + 1,
      };

      await ResearchFS.writeYaml(resolvePath(id), updated);
      return updated;
    });
  }

  export async function transition(id: string, newStatus: StorySpine["status"]): Promise<StorySpine | undefined> {
    return update(id, { status: newStatus });
  }

  export async function addReframe(
    id: string,
    reframe: {
      from_type: string;
      to_type: string;
      rationale: string;
    },
  ): Promise<StorySpine | undefined> {
    const story = await read(id);
    if (!story) return undefined;

    const updated: StorySpine = {
      ...story,
      reframe_history: [...story.reframe_history, reframe],
      version: story.version + 1,
    };

    await ResearchFS.writeYaml(resolvePath(id), updated);
    return updated;
  }

  export async function list(): Promise<StorySpine[]> {
    const dir = ResearchFS.resolve(DIR);
    let files: string[] = [];
    try {
      const fs = await import("fs/promises");
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".story.yaml"));
    } catch {
      // directory doesn't exist yet — no stories to list
      return [];
    }

    const stories: StorySpine[] = [];
    for (const file of files) {
      const story = await read(file.replace(".story.yaml", ""));
      if (story) stories.push(story);
    }
    return stories.sort((a, b) => a.id.localeCompare(b.id));
  }

  export async function queryByStatus(status: StorySpine["status"]): Promise<StorySpine[]> {
    const stories = await list();
    return stories.filter((s) => s.status === status);
  }

  export async function getByIdeaRef(ideaRef: string): Promise<StorySpine | undefined> {
    const stories = await list();
    return stories.find((s) => s.idea_ref === ideaRef);
  }
}
