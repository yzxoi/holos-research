import {
  classifyFetchError,
  fetchWithTimeout,
  httpFailure,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "../infra";
import { cleanArxivId, type FetchOutcome, type FetchSource } from "../types";

export async function fetchArxivMetadata(arxivId: string, signal?: AbortSignal): Promise<FetchOutcome> {
  const cleanId = cleanArxivId(arxivId);
  const source: FetchSource = "arxiv";

  if (isCircuitOpen(source)) {
    return {
      ok: false,
      failure: {
        source,
        reason: "arXiv circuit breaker open — skipping due to repeated failures. Resets in ~60s.",
        retryable: true,
      },
    };
  }

  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      `https://export.arxiv.org/api/query?id_list=${cleanId}&max_results=1`,
      undefined,
      8000,
      signal,
    );
  } catch (err) {
    recordFailure(source);
    return { ok: false, failure: classifyFetchError(err, source) };
  }

  if (!resp.ok) {
    recordFailure(source);
    return { ok: false, failure: httpFailure(source, resp.status, "arXiv API") };
  }

  let xml: string;
  try {
    xml = await resp.text();
  } catch {
    // non-fatal: response body read failed
    return { ok: false, failure: { source, reason: "arXiv API returned empty body", retryable: true } };
  }

  if (xml.includes("<totalResults>0</totalResults>")) {
    return {
      ok: false,
      failure: { source, reason: `arXiv:${cleanId} not found — may be an invalid or withdrawn ID`, retryable: false },
    };
  }

  const title = xml
    .match(/<title[^>]*>([\s\S]*?)<\/title>/g)?.[1]
    ?.replace(/<\/?title[^>]*>/g, "")
    ?.replace(/\s+/g, " ")
    ?.trim();

  if (!title || title === "Error") {
    return {
      ok: false,
      failure: {
        source,
        reason: `arXiv API returned a response for ${cleanId} but could not extract title — XML format may have changed`,
        retryable: false,
      },
    };
  }

  const authors = [...xml.matchAll(/<name>(.*?)<\/name>/g)].map((m) => m[1]!.trim());
  const published = xml.match(/<published>(.*?)<\/published>/)?.[1];
  const year = published ? new Date(published).getFullYear() : undefined;
  const realDOI = xml.match(/<arxiv:doi[^>]*>(.*?)<\/arxiv:doi>/)?.[1];
  const journalRef = xml.match(/<arxiv:journal_ref[^>]*>(.*?)<\/arxiv:journal_ref>/)?.[1];

  const citeKey = (authors[0]?.split(" ").pop()?.toLowerCase() ?? "unknown") + (year ?? "");
  const authorBib = authors.join(" and ");
  const bibTeX = journalRef
    ? [
        `@article{${citeKey},`,
        `  title={${title}},`,
        `  author={${authorBib}},`,
        year ? `  year={${year}},` : "",
        `  journal={${journalRef}},`,
        `  note={arXiv:${cleanId}},`,
        realDOI ? `  doi={${realDOI}},` : "",
        `}`,
      ]
        .filter(Boolean)
        .join("\n")
    : [
        `@misc{${citeKey},`,
        `  title={${title}},`,
        `  author={${authorBib}},`,
        year ? `  year={${year}},` : "",
        `  eprint={${cleanId}},`,
        `  archivePrefix={arXiv},`,
        realDOI ? `  doi={${realDOI}},` : "",
        `}`,
      ]
        .filter(Boolean)
        .join("\n");

  recordSuccess(source);
  return {
    ok: true,
    data: {
      title,
      authors,
      year,
      venue: journalRef ?? undefined,
      doi: realDOI ?? undefined,
      arxiv: cleanId,
      bibTeX,
      source,
    },
  };
}
