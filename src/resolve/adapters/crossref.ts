import {
  classifyFetchError,
  fetchWithTimeout,
  httpFailure,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "../infra";
import type { FetchOutcome, FetchSource } from "../types";

export async function fetchCrossRefMetadata(doi: string, signal?: AbortSignal): Promise<FetchOutcome> {
  const source: FetchSource = "crossref";

  if (isCircuitOpen(source)) {
    return {
      ok: false,
      failure: {
        source,
        reason: "CrossRef circuit breaker open — skipping due to repeated failures. Resets in ~60s.",
        retryable: true,
      },
    };
  }

  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      {
        headers: { Accept: "application/json", "User-Agent": "SynergyResearch/1.0 (mailto:research@synergy.dev)" },
      },
      8000,
      signal,
    );
  } catch (err) {
    recordFailure(source);
    return { ok: false, failure: classifyFetchError(err, source) };
  }

  if (!resp.ok) {
    recordFailure(source);
    return { ok: false, failure: httpFailure(source, resp.status, "CrossRef") };
  }

  let data: any;
  try {
    data = await resp.json();
  } catch {
    // non-fatal: JSON parse failed — API returned malformed response
    return { ok: false, failure: { source, reason: "CrossRef returned unparseable JSON", retryable: false } };
  }

  const work = data?.message;
  if (!work) {
    return {
      ok: false,
      failure: { source, reason: `CrossRef: DOI ${doi} not found in CrossRef index`, retryable: false },
    };
  }

  const title = Array.isArray(work.title) ? work.title[0] : work.title;
  const authors = (work.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(" "));
  const year = work.published?.["date-parts"]?.[0]?.[0] ?? work.created?.["date-parts"]?.[0]?.[0];
  const venue = work["container-title"]?.[0];
  const citeKey = (work.author?.[0]?.family?.toLowerCase() ?? "unknown") + (year ?? "");

  const bibTeX = [
    `@article{${citeKey},`,
    `  title={${title}},`,
    `  author={${authors.join(" and ")}}`,
    year ? `  year={${year}},` : "",
    venue ? `  journal={${venue}},` : "",
    `  doi={${doi}},`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");

  recordSuccess(source);
  return { ok: true, data: { title, authors, year, venue, doi, bibTeX, source } };
}
