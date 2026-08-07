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
 * DataCite adapter — for DOIs registered with DataCite (arXiv, Zenodo, Figshare, etc.).
 * CrossRef does not index these DOIs — they will always 404 on CrossRef.
 */
export async function fetchDataCiteMetadata(doi: string, signal?: AbortSignal): Promise<FetchOutcome> {
  const source: FetchSource = "datacite";

  if (isCircuitOpen(source)) {
    return {
      ok: false,
      failure: {
        source,
        reason: "DataCite circuit breaker open — skipping due to repeated failures. Resets in ~60s.",
        retryable: true,
      },
    };
  }

  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      `https://api.datacite.org/dois/${encodeURIComponent(doi)}`,
      {
        headers: { Accept: "application/json" },
      },
      6000,
      signal,
    );
  } catch (err) {
    recordFailure(source);
    return { ok: false, failure: classifyFetchError(err, source) };
  }

  if (!resp.ok) {
    recordFailure(source);
    return { ok: false, failure: httpFailure(source, resp.status, "DataCite") };
  }

  let data: any;
  try {
    data = await resp.json();
  } catch {
    // non-fatal: JSON parse failed — API returned malformed response
    return { ok: false, failure: { source, reason: "DataCite returned unparseable JSON", retryable: false } };
  }

  const attrs = data?.data?.attributes;
  if (!attrs?.titles?.[0]?.title) {
    return { ok: false, failure: { source, reason: `DataCite: DOI ${doi} has no title`, retryable: false } };
  }

  const title = attrs.titles[0].title as string;
  const authors = (attrs.creators ?? []).map((c: any) => c.name).filter(Boolean) as string[];
  const year = attrs.publicationYear as number | undefined;
  const venue = attrs.titles?.[1]?.title as string | undefined; // sometimes secondary title is venue

  const citeKey = (authors[0]?.split(",").at(0)?.trim().toLowerCase().replace(/\s+/g, "") ?? "unknown") + (year ?? "");
  const bibTeX = [
    `@misc{${citeKey},`,
    `  title={${title}},`,
    authors.length > 0 ? `  author={${authors.join(" and ")}},` : "",
    year ? `  year={${year}},` : "",
    venue ? `  note={${venue}},` : "",
    `  doi={${doi}},`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");

  recordSuccess(source);
  return { ok: true, data: { title, authors, year, venue, doi, bibTeX, source } };
}
