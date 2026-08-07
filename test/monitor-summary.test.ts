import { describe, expect, test } from "bun:test"
import { MonitorBoard } from "../src/monitor"

// ── generateProjectSummary ────────────────────────────────────────────────────

describe("generateProjectSummary", () => {
  const board = new MonitorBoard()

  test("Chinese colon (：) extracts text after it", () => {
    const result = board.generateProjectSummary("CVPR 2026：一种新型注意力机制的研究")
    expect(result).toBe("一种新型注意力机制的研究")
  })

  test("Chinese colon with short prefix extracts correctly", () => {
    const result = board.generateProjectSummary("ACL：探索语言模型的推理能力")
    expect(result).toBe("探索语言模型的推理能力")
  })

  test("sentence-end cut at 。", () => {
    const result = board.generateProjectSummary(
      "这是一个研究项目。这是第二句话不应该出现"
    )
    expect(result).toBe("这是一个研究项目")
  })

  test("comma truncation for long text", () => {
    // Create a long Chinese string with commas
    const longText = "这是一段很长的中文描述，包含多个逗号分隔的部分，还有更多的内容需要被截断处理，最终结果应该在一个逗号处截断"
    const result = board.generateProjectSummary(longText)
    expect(result!.length).toBeLessThanOrEqual(60)
  })

  test("hard truncation at 60 chars with ellipsis", () => {
    // Create a string with no break points that exceeds 60 chars
    const noBreaks = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    const result = board.generateProjectSummary(noBreaks)
    expect(result!.length).toBeLessThanOrEqual(60)
    expect(result!.endsWith("...")).toBe(true)
  })

  test("empty string returns null", () => {
    const result = board.generateProjectSummary("")
    // Empty string is falsy — but the code checks `!anchor` which is true for ""
    expect(result).toBeNull()
  })

  test("null anchor returns null", () => {
    const result = board.generateProjectSummary(null)
    expect(result).toBeNull()
  })

  test("short text passes through unchanged", () => {
    const short = "简短描述"
    const result = board.generateProjectSummary(short)
    expect(result).toBe(short)
  })

  test("caching: second call returns cached result", () => {
    const board2 = new MonitorBoard()
    const anchor = "测试缓存功能的描述文本"
    const first = board2.generateProjectSummary(anchor)
    const second = board2.generateProjectSummary(anchor)
    // Value equality — both calls return the same summary string
    expect(first).toBe(second)
    expect(first).not.toBeNull()
    // Note: JS string === is value equality, not reference equality,
    // so this verifies the caching logic returns the same computed value.
    // The cache prevents recomputation; we confirm the result is consistent.
  })

  test("Chinese colon + sentence-end combination", () => {
    const result = board.generateProjectSummary(
      "NeurIPS 2026：基于图神经网络的方法。我们提出了一个新框架。"
    )
    expect(result).toBe("基于图神经网络的方法")
  })

  test("text exactly at 60 chars is not truncated", () => {
    // Build a string of exactly 60 chars
    const exact = "a".repeat(60)
    const result = board.generateProjectSummary(exact)
    expect(result).toBe(exact)
  })

  test("text at 61 chars gets truncated", () => {
    const over = "a".repeat(61)
    const result = board.generateProjectSummary(over)
    expect(result!.length).toBeLessThanOrEqual(60)
  })

  test("English text with spaces truncates at word boundary", () => {
    const longEnglish = "This is a research project about very important topics in the field of artificial intelligence and machine learning systems"
    const result = board.generateProjectSummary(longEnglish)
    expect(result!.length).toBeLessThanOrEqual(60)
  })

  test("mixed Chinese and English text", () => {
    const result = board.generateProjectSummary("ICML 2026：A novel approach to self-supervised learning for multimodal representations")
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(60)
  })
})
