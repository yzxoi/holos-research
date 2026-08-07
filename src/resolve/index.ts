import { fetchArxivMetadata } from "./adapters/arxiv";
import { fetchCrossRefMetadata } from "./adapters/crossref";
import { fetchDataCiteMetadata } from "./adapters/datacite";
import { fetchDBLPMetadata } from "./adapters/dblp";
import { fetchOpenAlexMetadata } from "./adapters/openalex";
import { fetchSemanticScholarMetadata } from "./adapters/semantic-scholar";
import { formatFailure } from "./infra";
import { cleanArxivId, doiRegistry, type FetchFailure, type ResolvedMetadata, sanitizeDOI } from "./types";

export type { ResolvedMetadata };
export { cleanArxivId };

export async function resolveMetadata(params: {
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  arxiv?: string;
  doi?: string;
  signal?: AbortSignal;
}): Promise<{ resolved: ResolvedMetadata; warnings: string[] }> {
  // Overall timeout: 15s max for the entire cascade, including the external signal
  const OVERALL_TIMEOUT = 15_000;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), OVERALL_TIMEOUT);

  // Also listen to external signal
  if (params.signal) {
    if (params.signal.aborted) {
      clearTimeout(timer);
      return fallbackToManual(params);
    }
    const onAbort = () => {
      timeoutController.abort();
      clearTimeout(timer);
    };
    params.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const onTimeout = () => {
        timeoutController.abort();
        reject(new Error(`Metadata resolution timed out after ${OVERALL_TIMEOUT}ms`));
      };
      setTimeout(onTimeout, OVERALL_TIMEOUT);
    });
    const signal = timeoutController.signal;
    return await Promise.race([resolveMetadataInner(params, signal), timeoutPromise]);
  } catch {
    return fallbackToManual(params);
  } finally {
    clearTimeout(timer);
  }
}

/** Fallback path when resolution times out or is aborted. */
function fallbackToManual(params: {
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  arxiv?: string;
  doi?: string;
}): { resolved: ResolvedMetadata; warnings: string[] } {
  const doi = params.doi ? sanitizeDOI(params.doi) : undefined;
  return {
    resolved: {
      title: params.title,
      authors: params.authors,
      year: params.year,
      venue: params.venue,
      doi: doi ?? params.doi,
      arxiv: params.arxiv ? cleanArxivId(params.arxiv) : undefined,
      source: "manual",
    },
    warnings: [
      params.arxiv || params.doi
        ? "Resolution timed out or was cancelled — BibTeX generated from manual metadata [UNVERIFIED]"
        : "No arxiv/doi provided — BibTeX generated from manual metadata [UNVERIFIED]",
    ],
  };
}

async function resolveMetadataInner(
  params: {
    title?: string;
    authors?: string[];
    year?: number;
    venue?: string;
    arxiv?: string;
    doi?: string;
  },
  signal: AbortSignal,
): Promise<{ resolved: ResolvedMetadata; warnings: string[] }> {
  if (signal.aborted) {
    // Already aborted — return manual fallback immediately
    throw new DOMException("Aborted", "AbortError");
  }
  const warnings: string[] = [];
  const failures: FetchFailure[] = [];

  const doi = params.doi ? sanitizeDOI(params.doi) : undefined;

  // ── Path 1: arXiv ID provided ──
  if (params.arxiv) {
    // DBLP → S2 → OpenAlex → arXiv API
    const dblp = await fetchDBLPMetadata(params.arxiv, params.title, signal);
    if (dblp.ok) {
      if (doi && !dblp.data.doi) dblp.data.doi = doi;
      return { resolved: dblp.data, warnings };
    }
    warnings.push(formatFailure(dblp.failure));
    failures.push(dblp.failure);

    const s2 = await fetchSemanticScholarMetadata(params.arxiv, signal);
    if (s2.ok) {
      if (doi && !s2.data.doi) s2.data.doi = doi;
      return { resolved: s2.data, warnings };
    }
    warnings.push(formatFailure(s2.failure));
    failures.push(s2.failure);

    const oa = await fetchOpenAlexMetadata({ title: params.title }, signal);
    if (oa.ok) {
      if (doi && !oa.data.doi) oa.data.doi = doi;
      if (!oa.data.arxiv) oa.data.arxiv = cleanArxivId(params.arxiv);
      return { resolved: oa.data, warnings };
    }
    warnings.push(formatFailure(oa.failure));
    failures.push(oa.failure);

    const ax = await fetchArxivMetadata(params.arxiv, signal);
    if (ax.ok) {
      if (doi && !ax.data.doi) ax.data.doi = doi;
      return { resolved: ax.data, warnings };
    }
    warnings.push(formatFailure(ax.failure));
    failures.push(ax.failure);
  }

  // ── Path 2: DOI provided ──
  if (doi) {
    const registry = doiRegistry(doi);

    if (registry === "crossref") {
      const cr = await fetchCrossRefMetadata(doi, signal);
      if (cr.ok) {
        if (params.arxiv && !cr.data.arxiv) cr.data.arxiv = cleanArxivId(params.arxiv);
        return { resolved: cr.data, warnings };
      }
      warnings.push(formatFailure(cr.failure));
      failures.push(cr.failure);

      // CrossRef failed — try OpenAlex as fallback for this DOI
      const oa = await fetchOpenAlexMetadata({ doi }, signal);
      if (oa.ok) {
        if (params.arxiv && !oa.data.arxiv) oa.data.arxiv = cleanArxivId(params.arxiv);
        return { resolved: oa.data, warnings };
      }
      warnings.push(formatFailure(oa.failure));
      failures.push(oa.failure);
    }

    if (registry === "datacite") {
      // DataCite-registered DOIs (arXiv, Zenodo, Figshare, etc.)
      const dc = await fetchDataCiteMetadata(doi, signal);
      if (dc.ok) {
        if (params.arxiv && !dc.data.arxiv) dc.data.arxiv = cleanArxivId(params.arxiv);
        return { resolved: dc.data, warnings };
      }
      warnings.push(formatFailure(dc.failure));
      failures.push(dc.failure);

      // DataCite failed — try OpenAlex as fallback
      const oa = await fetchOpenAlexMetadata({ doi }, signal);
      if (oa.ok) {
        if (params.arxiv && !oa.data.arxiv) oa.data.arxiv = cleanArxivId(params.arxiv);
        return { resolved: oa.data, warnings };
      }
      warnings.push(formatFailure(oa.failure));
      failures.push(oa.failure);
    }
  }

  // ── Path 3: Title-only (no arXiv, no DOI) ──
  if (params.title && !params.arxiv && !doi) {
    const oa = await fetchOpenAlexMetadata({ title: params.title }, signal);
    if (oa.ok) return { resolved: oa.data, warnings };
    warnings.push(formatFailure(oa.failure));
    failures.push(oa.failure);
  }

  // ── Fallback: manual metadata ──
  const retryableCount = failures.filter((f) => f.retryable).length;
  const guidance =
    retryableCount > 0
      ? `${retryableCount} failures are retryable — retry later or check network/VPN before ingesting with manual metadata`
      : "All failures are permanent — the paper may be too new for automated indexing";

  warnings.push(
    params.arxiv || doi
      ? `All external APIs failed (${failures.length} sources tried). ${guidance}. BibTeX generated from manual metadata [UNVERIFIED]`
      : "No arxiv/doi provided — BibTeX generated from manual metadata only [UNVERIFIED]",
  );

  return {
    resolved: {
      title: params.title,
      authors: params.authors,
      year: params.year,
      venue: params.venue,
      doi: doi ?? params.doi,
      arxiv: params.arxiv ? cleanArxivId(params.arxiv) : undefined,
      source: "manual",
    },
    warnings,
  };
}
