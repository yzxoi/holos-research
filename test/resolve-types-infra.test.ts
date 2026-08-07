import { describe, expect, test } from "bun:test"
import { cleanArxivId, sanitizeDOI, doiRegistry } from "../src/resolve/types"
import { classifyFetchError, httpFailure, formatFailure } from "../src/resolve/infra"

// ── cleanArxivId ──────────────────────────────────────────────────────────────

describe("cleanArxivId", () => {
  test("removes arxiv: prefix (case insensitive)", () => {
    expect(cleanArxivId("arxiv:2401.12345")).toBe("2401.12345")
    expect(cleanArxivId("ARXIV:2401.12345")).toBe("2401.12345")
  })

  test("strips version suffix", () => {
    expect(cleanArxivId("2401.12345v2")).toBe("2401.12345")
    expect(cleanArxivId("arxiv:2401.12345v1")).toBe("2401.12345")
  })

  test("already clean ID passes through", () => {
    expect(cleanArxivId("2401.12345")).toBe("2401.12345")
  })

  test("old-format arXiv ID", () => {
    expect(cleanArxivId("hep-th/9901001")).toBe("hep-th/9901001")
  })
})

// ── sanitizeDOI ───────────────────────────────────────────────────────────────

describe("sanitizeDOI", () => {
  test("strips https://doi.org/ prefix", () => {
    expect(sanitizeDOI("https://doi.org/10.1234/test")).toBe("10.1234/test")
  })

  test("strips http://doi.org/ prefix", () => {
    expect(sanitizeDOI("http://doi.org/10.1234/test")).toBe("10.1234/test")
  })

  test("already clean DOI passes through", () => {
    expect(sanitizeDOI("10.1234/test")).toBe("10.1234/test")
  })
})

// ── doiRegistry ───────────────────────────────────────────────────────────────

describe("doiRegistry", () => {
  test("arXiv DOI → datacite", () => {
    expect(doiRegistry("10.48550/arXiv.2401.12345")).toBe("datacite")
  })

  test("PsyArXiv/OSF → datacite", () => {
    expect(doiRegistry("10.31234/OSF-XXXX")).toBe("datacite")
  })

  test("OSF → datacite", () => {
    expect(doiRegistry("10.17605/OSF.IO/XXXX")).toBe("datacite")
  })

  test("Zenodo → datacite", () => {
    expect(doiRegistry("10.5281/zenodo.1234567")).toBe("datacite")
  })

  test("Figshare → datacite", () => {
    expect(doiRegistry("10.6084/m9.figshare.1234567")).toBe("datacite")
  })

  test("Dagstuhl → datacite", () => {
    expect(doiRegistry("10.4230/LIPIcs.xxx")).toBe("datacite")
  })

  test("bioRxiv → crossref (not datacite!)", () => {
    expect(doiRegistry("10.1101/2024.01.01.123456")).toBe("crossref")
  })

  test("Nature → crossref", () => {
    expect(doiRegistry("10.1038/s41586-024-12345-6")).toBe("crossref")
  })

  test("unknown prefix → crossref (safe default)", () => {
    expect(doiRegistry("10.5555/unknown")).toBe("crossref")
  })
})

// ── classifyFetchError ────────────────────────────────────────────────────────

describe("classifyFetchError", () => {
  test("ECONNRESET → retryable", () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" })
    expect(classifyFetchError(err, "dblp").retryable).toBe(true)
  })

  test("ETIMEDOUT → retryable", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
    expect(classifyFetchError(err, "dblp").retryable).toBe(true)
  })

  test("ENOTFOUND → not retryable", () => {
    const err = Object.assign(new Error("not found"), { code: "ENOTFOUND" })
    expect(classifyFetchError(err, "dblp").retryable).toBe(false)
  })

  test("ECONNREFUSED → not retryable", () => {
    const err = Object.assign(new Error("refused"), { code: "ECONNREFUSED" })
    expect(classifyFetchError(err, "dblp").retryable).toBe(false)
  })

  test("unknown error → retryable (conservative)", () => {
    expect(classifyFetchError(new Error("weird"), "dblp").retryable).toBe(true)
  })

  test("non-Error thrown → retryable", () => {
    expect(classifyFetchError("string error", "dblp").retryable).toBe(true)
  })
})

// ── httpFailure ───────────────────────────────────────────────────────────────

describe("httpFailure", () => {
  test("429 → retryable", () => {
    expect(httpFailure("dblp", 429, "DBLP").retryable).toBe(true)
  })

  test("502 → retryable", () => {
    expect(httpFailure("dblp", 502, "DBLP").retryable).toBe(true)
  })

  test("503 → retryable", () => {
    expect(httpFailure("dblp", 503, "DBLP").retryable).toBe(true)
  })

  test("404 → not retryable", () => {
    expect(httpFailure("dblp", 404, "DBLP").retryable).toBe(false)
  })

  test("403 → not retryable", () => {
    expect(httpFailure("dblp", 403, "DBLP").retryable).toBe(false)
  })

  test("500 → retryable", () => {
    expect(httpFailure("dblp", 500, "DBLP").retryable).toBe(true)
  })

  test("200 → not retryable (not a server error)", () => {
    expect(httpFailure("dblp", 200, "DBLP").retryable).toBe(false)
  })
})

// ── formatFailure ─────────────────────────────────────────────────────────────

describe("formatFailure", () => {
  test("includes source name", () => {
    expect(formatFailure({ source: "dblp", reason: "test", retryable: true })).toContain("dblp")
  })

  test("retryable → [retryable] tag", () => {
    expect(formatFailure({ source: "dblp", reason: "test", retryable: true })).toContain("[retryable]")
  })

  test("permanent → [permanent] tag", () => {
    expect(formatFailure({ source: "dblp", reason: "test", retryable: false })).toContain("[permanent]")
  })
})
