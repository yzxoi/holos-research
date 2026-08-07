import {
  classifyFetchError,
  fetchWithTimeout,
  httpFailure,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "../infra";
import { cleanArxivId, type FetchOutcome, type FetchSource } from "../types";

export async function fetchSemanticScholarMetadata(arxiv: string, signal?: AbortSignal): Promise<FetchOutcome> {
  const cleanId = cleanArxivId(arxiv);
  const source: FetchSource = "semantic_scholar";

  if (isCircuitOpen(source)) {
    return {
      ok: false,
      failure: {
        source,
        reason: "S2 circuit breaker open — skipping due to repeated failures. Resets in ~60s.",
        retryable: true,
      },
    };
  }

  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      `https://api.semanticscholar.org/graph/v1/paper/ArXiv:${cleanId}?fields=title,authors,year,venue,journal,publicationTypes,citationStyles,externalIds`,
      { headers: { Accept: "application/json" } },
      5000,
      signal,
    );
  } catch (err) {
    recordFailure(source);
    return { ok: false, failure: classifyFetchError(err, source) };
  }

  if (!resp.ok) {
    recordFailure(source);
    return { ok: false, failure: httpFailure(source, resp.status, "Semantic Scholar") };
  }

  let data: any;
  try {
    data = await resp.json();
  } catch {
    // non-fatal: JSON parse failed — API returned malformed response
    return {
      ok: false,
      failure: { source, reason: "S2 returned unparseable JSON — API may have changed", retryable: false },
    };
  }

  if (!data?.title) {
    return {
      ok: false,
      failure: { source, reason: `S2: paper arXiv:${cleanId} not found in Semantic Scholar index`, retryable: false },
    };
  }

  recordSuccess(source);
  return {
    ok: true,
    data: {
      title: data.title as string,
      authors: (data.authors ?? []).map((a: any) => a.name as string),
      year: data.year as number | undefined,
      venue: (data.venue as string | undefined) ?? (data.journal?.name as string | undefined) ?? undefined,
      doi: (data.externalIds?.DOI as string | undefined) ?? undefined,
      arxiv: cleanId,
      bibTeX: data.citationStyles?.bibtex as string | undefined,
      source,
    },
  };
}
