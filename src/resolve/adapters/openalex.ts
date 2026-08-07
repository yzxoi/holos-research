import {
  classifyFetchError,
  fetchWithTimeout,
  httpFailure,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "../infra";
import type { FetchOutcome, FetchSource } from "../types";

/**
 * OpenAlex adapter — broad coverage across all disciplines.
 * Can query by DOI, title, or OpenAlex ID.
 */
export async function fetchOpenAlexMetadata(
  params: { doi?: string; title?: string },
  signal?: AbortSignal,
): Promise<FetchOutcome> {
  const source: FetchSource = "openalex";

  if (isCircuitOpen(source)) {
    return {
      ok: false,
      failure: {
        source,
        reason: "OpenAlex circuit breaker open — skipping due to repeated failures. Resets in ~60s.",
        retryable: true,
      },
    };
  }

  let resp: Response;
  try {
    if (params.doi) {
      // DOI-based lookup: https://api.openalex.org/works/doi:10.xxxx
      resp = await fetchWithTimeout(
        `https://api.openalex.org/works/doi:${encodeURIComponent(params.doi)}`,
        { headers: { Accept: "application/json" } },
        6000,
        signal,
      );
    } else if (params.title) {
      // Title-based search: filter by title, return top result
      const query = encodeURIComponent(params.title.trim().split(" ").slice(0, 8).join(" "));
      resp = await fetchWithTimeout(
        `https://api.openalex.org/works?search=${query}&per_page=1`,
        { headers: { Accept: "application/json" } },
        6000,
        signal,
      );
    } else {
      return { ok: false, failure: { source, reason: "OpenAlex requires at least a DOI or title", retryable: false } };
    }
  } catch (err) {
    recordFailure(source);
    return { ok: false, failure: classifyFetchError(err, source) };
  }

  if (!resp.ok) {
    recordFailure(source);
    return { ok: false, failure: httpFailure(source, resp.status, "OpenAlex") };
  }

  let data: any;
  try {
    data = await resp.json();
  } catch {
    // non-fatal: JSON parse failed — API returned malformed response
    return { ok: false, failure: { source, reason: "OpenAlex returned unparseable JSON", retryable: false } };
  }

  // DOI lookup returns a single work; title search returns results array
  const work = params.doi ? data : data?.results?.[0];
  if (!work?.title) {
    return { ok: false, failure: { source, reason: "OpenAlex: no matching work found", retryable: false } };
  }

  const authors = (work.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean) as string[];
  const year = work.publication_year as number | undefined;
  const venue = work.primary_location?.source?.display_name as string | undefined;
  const doi = work.doi?.replace("https://doi.org/", "") as string | undefined;
  const arxiv = (work.ids?.arxiv as string | undefined)?.replace("https://arxiv.org/", "");

  // Build BibTeX
  const citeKey = (authors[0]?.split(" ").pop()?.toLowerCase() ?? "unknown") + (year ?? "");
  const bibTeX = [
    `@article{${citeKey},`,
    `  title={${work.title}},`,
    authors.length > 0 ? `  author={${authors.join(" and ")}},` : "",
    year ? `  year={${year}},` : "",
    venue ? `  journal={${venue}},` : "",
    doi ? `  doi={${doi}},` : "",
    arxiv ? `  note={arXiv:${arxiv}},` : "",
    `}`,
  ]
    .filter(Boolean)
    .join("\n");

  recordSuccess(source);
  return {
    ok: true,
    data: { title: work.title, authors, year, venue, doi, arxiv, bibTeX, source },
  };
}
