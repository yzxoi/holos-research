import { ResearchFS } from "./fs";
import { getMutex, withLock } from "./lock";
import type { ReviewEntry } from "./schema";
import { ReviewerRole } from "./schema";

const VALID_REVIEWER_ROLES = new Set<string>(ReviewerRole.options);

const reviewMutex = getMutex("review");

/**
 * Shared review infrastructure for all object tools.
 *
 * Every object tool that supports action="review" uses these helpers to:
 * 1. Append a structured review entry to {id}.reviews.jsonl
 * 2. Write the full reviewer output to {id}.review.NNN.md
 * 3. Read review history for an object
 */
export namespace ResearchReview {
  /**
   * Count existing reviews for an object (to determine next round number).
   */
  export async function countReviews(dir: string, id: string): Promise<number> {
    const entries = await ResearchFS.readJsonl<ReviewEntry>(ResearchFS.resolve(dir, `${id}.reviews.jsonl`));
    return entries.length;
  }

  /**
   * Append a review entry and optionally write the review body markdown.
   * Returns the round number and the review file name.
   */
  export async function addReview(
    dir: string,
    id: string,
    params: {
      reviewer: string;
      focus?: string;
      verdict?: ReviewEntry["verdict"];
      summary: string;
      action_items?: string[];
      scores?: Record<string, number>;
      review_body?: string;
    },
  ): Promise<{ round: number; review_file: string }> {
    return withLock(reviewMutex, async () => {
      const existing = await countReviews(dir, id);
      const round = existing + 1;
      const reviewFilename = `${id}.review.${String(round).padStart(3, "0")}.md`;

      // Write review body markdown if provided
      if (params.review_body) {
        await ResearchFS.writeMd(ResearchFS.resolve(dir, reviewFilename), params.review_body);
      }

      // Append structured entry
      if (!VALID_REVIEWER_ROLES.has(params.reviewer)) {
        throw new Error(
          `Invalid reviewer role: "${params.reviewer}". Must be one of: ${ReviewerRole.options.join(", ")}`,
        );
      }
      const entry: ReviewEntry = {
        ts: new Date().toISOString(),
        round,
        reviewer: params.reviewer as ReviewEntry["reviewer"],
        focus: params.focus,
        verdict: params.verdict,
        summary: params.summary,
        action_items: params.action_items,
        scores: params.scores,
        review_file: params.review_body ? reviewFilename : undefined,
      };

      await ResearchFS.appendJsonl(ResearchFS.resolve(dir, `${id}.reviews.jsonl`), entry);

      return { round, review_file: reviewFilename };
    });
  }

  /**
   * Read all review entries for an object.
   * Handles backward compat: old entries may have `raw_md` instead of `review_file`.
   */
  export async function readReviews(dir: string, id: string): Promise<ReviewEntry[]> {
    const raw = await ResearchFS.readJsonl<any>(ResearchFS.resolve(dir, `${id}.reviews.jsonl`));
    // Migrate old raw_md field to review_file
    return raw.map((entry: any) => ({
      ...entry,
      review_file: entry.review_file ?? entry.raw_md,
      raw_md: undefined,
    }));
  }

  /**
   * Format a review summary for tool output.
   */
  export function formatReviewOutput(
    id: string,
    round: number,
    params: {
      reviewer: string;
      verdict?: string;
      summary: string;
      scores?: Record<string, number>;
      review_file: string;
    },
  ): string {
    const lines = [
      `✅ Review recorded for ${id} (round ${round})`,
      "",
      `Reviewer: ${params.reviewer}`,
      ...(params.verdict ? [`Verdict: ${params.verdict}`] : []),
      `Summary: ${params.summary}`,
    ];

    if (params.scores && Object.keys(params.scores).length > 0) {
      lines.push("");
      lines.push("Scores:");
      for (const [k, v] of Object.entries(params.scores)) {
        lines.push(`  ${k}: ${v}`);
      }
    }

    lines.push("");
    lines.push(`Files:`);
    lines.push(`  .research/*/${id}.reviews.jsonl (structured log)`);
    if (params.review_file) {
      lines.push(`  .research/*/${params.review_file} (full review body)`);
    }

    return lines.join("\n");
  }
}
