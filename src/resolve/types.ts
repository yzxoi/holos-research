export interface ResolvedMetadata {
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxiv?: string;
  bibTeX?: string;
  source: "dblp" | "semantic_scholar" | "openalex" | "arxiv" | "crossref" | "datacite" | "manual";
}

export type FetchSource = ResolvedMetadata["source"];

export interface FetchFailure {
  source: FetchSource;
  reason: string;
  retryable: boolean;
}

export type FetchOutcome = { ok: true; data: ResolvedMetadata } | { ok: false; failure: FetchFailure };

export function cleanArxivId(raw: string): string {
  return raw.replace(/^(arxiv:)/i, "").replace(/v\d+$/, "");
}

export function sanitizeDOI(raw: string): string {
  return raw.replace(/^https?:\/\/doi\.org\//, "");
}

/** Classify a DOI by its registration agency. */
export function doiRegistry(doi: string): "crossref" | "datacite" | "unknown" {
  // DataCite-registered prefixes (arXiv, PsyArXiv, many institutional repos)
  if (doi.startsWith("10.48550/")) return "datacite"; // arXiv
  if (doi.startsWith("10.31234/")) return "datacite"; // PsyArXiv / OSF
  if (doi.startsWith("10.17605/")) return "datacite"; // OSF
  if (doi.startsWith("10.5281/")) return "datacite"; // Zenodo
  if (doi.startsWith("10.6084/")) return "datacite"; // Figshare
  if (doi.startsWith("10.4230/")) return "datacite"; // Dagstuhl
  // bioRxiv/medRxiv are CrossRef-registered — good quality
  if (doi.startsWith("10.1101/")) return "crossref";
  return "crossref"; // default: most DOIs are CrossRef
}
