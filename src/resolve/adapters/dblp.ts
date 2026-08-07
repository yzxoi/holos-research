import {
  classifyFetchError,
  fetchWithTimeout,
  httpFailure,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "../infra";
import { cleanArxivId, type FetchOutcome, type FetchSource } from "../types";

export async function fetchDBLPMetadata(arxiv: string, rawTitle?: string, signal?: AbortSignal): Promise<FetchOutcome> {
  const cleanId = cleanArxivId(arxiv);
  const source: FetchSource = "dblp";

  if (isCircuitOpen(source)) {
    return {
      ok: false,
      failure: {
        source,
        reason: "DBLP circuit breaker open — skipping due to repeated failures. Resets in ~60s.",
        retryable: true,
      },
    };
  }

  const dblpArxivKey = `journals/corr/abs-${cleanId.replace(".", "-")}`;
  let bibResp: Response | null = null;
  let corrStatus = 0;

  try {
    bibResp = await fetchWithTimeout(`https://dblp.org/rec/${dblpArxivKey}.bib`, undefined, 5000, signal);
    corrStatus = bibResp?.status ?? 0;
  } catch (err) {
    recordFailure(source);
    return { ok: false, failure: classifyFetchError(err, source) };
  }

  if (!bibResp?.ok && corrStatus === 404 && rawTitle) {
    try {
      const searchTerm = encodeURIComponent(rawTitle.trim().split(" ").slice(0, 6).join(" "));
      const searchResp = await fetchWithTimeout(
        `https://dblp.org/search/publ/api?q=${searchTerm}&format=json&h=1`,
        undefined,
        5000,
        signal,
      );
      if (!searchResp.ok) {
        recordFailure(source);
        return { ok: false, failure: httpFailure(source, searchResp.status, `DBLP title search`) };
      }
      const data = (await searchResp.json()) as Record<string, unknown>;
      const result = data?.result as Record<string, unknown> | undefined;
      const hits = result?.hits as Record<string, unknown> | undefined;
      const hitList = hits?.hit as Array<Record<string, unknown>> | undefined;
      const info = hitList?.[0]?.info as Record<string, unknown> | undefined;
      const key = info?.key as string | undefined;
      if (!key) {
        return {
          ok: false,
          failure: {
            source,
            reason: "DBLP title search returned no matching papers for this arXiv ID",
            retryable: false,
          },
        };
      }
      bibResp = await fetchWithTimeout(`https://dblp.org/rec/${key}.bib`, undefined, 5000, signal);
      if (!bibResp?.ok) {
        recordFailure(source);
        return {
          ok: false,
          failure: httpFailure(source, bibResp?.status ?? 0, "DBLP BibTeX fetch after title search"),
        };
      }
    } catch (err) {
      recordFailure(source);
      return { ok: false, failure: classifyFetchError(err, source) };
    }
  }

  if (!bibResp?.ok) {
    recordFailure(source);
    return { ok: false, failure: httpFailure(source, corrStatus || bibResp?.status || 0, "DBLP CoRR key") };
  }

  let bibText: string;
  try {
    bibText = await bibResp.text();
  } catch {
    // non-fatal: response body read failed
    return { ok: false, failure: { source, reason: "DBLP returned empty/invalid BibTeX body", retryable: false } };
  }

  const title = bibText.match(/\btitle\s*=\s*\{(.+?)\}/s)?.[1]?.trim();
  if (!title) {
    return {
      ok: false,
      failure: {
        source,
        reason: "DBLP BibTeX parse failed: could not extract title — API format may have changed",
        retryable: false,
      },
    };
  }

  const authors =
    bibText
      .match(/\bauthor\s*=\s*\{(.+?)\}/s)?.[1]
      ?.split(/\s+and\s+/)
      .map((a) => a.replace(/\n\s*/g, " ").trim()) ?? [];
  const year = parseInt(bibText.match(/\byear\s*=\s*\{(\d{4})\}/)?.[1] ?? "", 10) || undefined;
  const venue =
    bibText.match(/\bbooktitle\s*=\s*\{(.+?)\}/s)?.[1]?.trim() ??
    bibText.match(/\bjournal\s*=\s*\{(.+?)\}/s)?.[1]?.trim();
  const doi = bibText.match(/\bdoi\s*=\s*(?:\d+\s+)?\{(.+?)\}/)?.[1];

  recordSuccess(source);
  return {
    ok: true,
    data: {
      title,
      authors,
      year,
      venue: venue ?? undefined,
      doi: doi ?? undefined,
      arxiv: cleanId,
      bibTeX: bibText,
      source,
    },
  };
}
