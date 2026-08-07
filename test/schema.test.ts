import { describe, expect, test } from "bun:test"
import {
  IdeaStatus, IdeaYaml,
  PlanStatus, PlanYaml,
  ExperimentStatus, ExperimentGroup, ExperimentBackend, ExperimentYaml,
  ClaimStatus, ClaimYaml,
  ExhibitStatus, ExhibitKind, ExhibitYaml,
  PaperStatus, PaperYaml,
  SubmissionStatus, SubmissionYaml,
  ReviewVerdict, ReviewEntry,
  ProjectPhase, ParticipationMode,
  EdgeType,
  TimelineEventType, TimelineEvent,
  ExplorationConfig, GroundConfig, DesignConfig, RealizeConfig, ExperimentConfig,
  ComposeConfig, StateYaml,
} from "../src/schema"

// ── Status enums reject invalid values ────────────────────────────────────────

describe("Schema enums reject invalid values", () => {
  test("IdeaStatus rejects garbage", () => {
    expect(IdeaStatus.safeParse("exploding").success).toBe(false)
  })

  test("PlanStatus rejects garbage", () => {
    expect(PlanStatus.safeParse("cooking").success).toBe(false)
  })

  test("ExperimentStatus rejects garbage", () => {
    expect(ExperimentStatus.safeParse("vaporized").success).toBe(false)
  })

  test("ClaimStatus rejects garbage", () => {
    expect(ClaimStatus.safeParse("legendary").success).toBe(false)
  })

  test("ExhibitStatus rejects garbage", () => {
    expect(ExhibitStatus.safeParse("imagined").success).toBe(false)
  })

  test("PaperStatus rejects garbage", () => {
    expect(PaperStatus.safeParse("dreaming").success).toBe(false)
  })

  test("SubmissionStatus rejects garbage", () => {
    expect(SubmissionStatus.safeParse("disappeared").success).toBe(false)
  })
})

// ── Status enums accept all valid values ──────────────────────────────────────

describe("Schema enums accept all valid values", () => {
  test("IdeaStatus accepts all values", () => {
    for (const v of IdeaStatus.options) {
      expect(IdeaStatus.safeParse(v).success).toBe(true)
    }
  })

  test("ExperimentGroup accepts all values", () => {
    for (const v of ExperimentGroup.options) {
      expect(ExperimentGroup.safeParse(v).success).toBe(true)
    }
  })

  test("ExperimentBackend accepts all values", () => {
    for (const v of ExperimentBackend.options) {
      expect(ExperimentBackend.safeParse(v).success).toBe(true)
    }
  })

  test("ExhibitKind accepts all values", () => {
    for (const v of ExhibitKind.options) {
      expect(ExhibitKind.safeParse(v).success).toBe(true)
    }
  })
})

// ── Entity YAML schemas validate correctly ────────────────────────────────────

describe("Entity YAML schema validation", () => {
  test("IdeaYaml accepts valid idea", () => {
    const result = IdeaYaml.safeParse({
      id: "idea_001",
      title: "Test Idea",
      status: "proposed",
      round: 1,
      created: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  test("IdeaYaml rejects missing required fields", () => {
    expect(IdeaYaml.safeParse({ id: "idea_001" }).success).toBe(false)
  })

  test("IdeaYaml rejects invalid status", () => {
    const result = IdeaYaml.safeParse({
      id: "idea_001",
      title: "Test",
      status: "invalid_status",
      created: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })

  test("ExperimentYaml accepts with optional fields omitted", () => {
    const result = ExperimentYaml.safeParse({
      id: "exp_001",
      title: "Test Experiment",
      status: "registered",
      created: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  test("ClaimYaml default evidence/caveats arrays", () => {
    const result = ClaimYaml.safeParse({
      id: "claim_001",
      title: "Test Claim",
      status: "candidate",
      created: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.evidence).toEqual([])
      expect(result.data.caveats).toEqual([])
    }
  })

  test("ExhibitYaml requires kind", () => {
    const result = ExhibitYaml.safeParse({
      id: "exh_001",
      title: "Test Exhibit",
      status: "draft",
      created: new Date().toISOString(),
    })
    expect(result.success).toBe(false) // missing kind
  })

  test("PaperYaml sections default to empty array", () => {
    const result = PaperYaml.safeParse({
      id: "paper_001",
      title: "Test Paper",
      status: "outlined",
      created: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sections).toEqual([])
    }
  })
})

// ── Review schema ─────────────────────────────────────────────────────────────

describe("Review schema", () => {
  test("ReviewVerdict accepts valid values", () => {
    expect(ReviewVerdict.safeParse("pass").success).toBe(true)
    expect(ReviewVerdict.safeParse("revise").success).toBe(true)
    expect(ReviewVerdict.safeParse("rethink").success).toBe(true)
  })

  test("ReviewVerdict rejects invalid", () => {
    expect(ReviewVerdict.safeParse("approve").success).toBe(false)
  })

  test("ReviewEntry validates correctly", () => {
    const result = ReviewEntry.safeParse({
      ts: new Date().toISOString(),
      round: 1,
      reviewer: "critic",
      summary: "Good idea but needs work",
    })
    expect(result.success).toBe(true)
  })
})

// ── Cross-cutting schema ──────────────────────────────────────────────────────

describe("Cross-cutting schema", () => {
  test("EdgeType accepts all values", () => {
    for (const v of EdgeType.options) {
      expect(EdgeType.safeParse(v).success).toBe(true)
    }
  })

  test("ProjectPhase accepts all phases", () => {
    for (const v of ProjectPhase.options) {
      expect(ProjectPhase.safeParse(v).success).toBe(true)
    }
  })

  test("TimelineEventType accepts all event types", () => {
    for (const v of TimelineEventType.options) {
      expect(TimelineEventType.safeParse(v).success).toBe(true)
    }
  })

  test("TimelineEvent with minimal fields validates", () => {
    const result = TimelineEvent.safeParse({
      ts: new Date().toISOString(),
      type: "idea.created",
      id: "idea_001",
    })
    expect(result.success).toBe(true)
  })
})

// ── Phase config schemas ──────────────────────────────────────────────────────

describe("Phase config schemas — defaults", () => {
  test("ExplorationConfig fills all defaults from empty object", () => {
    const result = ExplorationConfig.parse({})
    expect(result.depth).toBe("standard")
    expect(result.pilot).toBe("enabled")
    expect(result.max_refine_rounds).toBe(3)
    expect(result.idea_select_score).toBe(8)
    expect(result.idea_generators).toBe(3)
  })

  test("GroundConfig fills defaults", () => {
    const result = GroundConfig.parse({})
    expect(result.max_review_rounds).toBe(2)
    expect(result.max_closest_works).toBe(3)
  })

  test("DesignConfig fills defaults", () => {
    const result = DesignConfig.parse({})
    expect(result.max_review_rounds).toBe(5)
    expect(result.score_threshold).toBe(7)
    expect(result.max_primary_claims).toBe(2)
    expect(result.max_new_components).toBe(2)
  })

  test("ExperimentConfig fills defaults", () => {
    const result = ExperimentConfig.parse({})
    expect(result.max_optimize_rounds).toBe(3)
    expect(result.monitor_interval).toBe("30m")
    expect(result.significance_level).toBe(0.05)
    expect(result.min_seeds).toBe(3)
    expect(result.regression_tolerance).toBe(0.05)
  })

  test("RealizeConfig fills defaults", () => {
    const result = RealizeConfig.parse({})
    expect(result.max_review_rounds).toBe(3)
    expect(result.code_review_threshold).toBe(7)
    expect(result.require_sanity_contract).toBe(true)
    expect(result.require_quality_contract).toBe(true)
  })

  test("ComposeConfig fills defaults", () => {
    const result = ComposeConfig.parse({})
    expect(result.max_revise_rounds).toBe(3)
  })
})

describe("Phase config schemas — partial override", () => {
  test("ExplorationConfig respects partial override", () => {
    const result = ExplorationConfig.parse({ depth: "thorough", idea_generators: 5 })
    expect(result.depth).toBe("thorough")
    expect(result.idea_generators).toBe(5)
    expect(result.pilot).toBe("enabled") // default preserved
    expect(result.max_refine_rounds).toBe(3) // default preserved
  })

  test("DesignConfig respects partial override", () => {
    const result = DesignConfig.parse({ max_review_rounds: 8 })
    expect(result.max_review_rounds).toBe(8)
    expect(result.score_threshold).toBe(7) // default preserved
  })

  test("RealizeConfig respects partial override", () => {
    const result = RealizeConfig.parse({ code_review_threshold: 9, max_review_rounds: 5 })
    expect(result.code_review_threshold).toBe(9)
    expect(result.max_review_rounds).toBe(5)
    expect(result.require_sanity_contract).toBe(true) // default preserved
  })
})

describe("StateYaml backward compatibility", () => {
  test("old state without phase configs parses with defaults", () => {
    const oldState = {
      project: "legacy-project",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      config: {
        participation_mode: "collaborative",
        exploration: { depth: "standard", pilot: "enabled" },
      },
      counters: { idea: 0, plan: 0, exp: 0, claim: 0, exh: 0, paper: 0, sub: 0 },
    }
    const result = StateYaml.safeParse(oldState)
    expect(result.success).toBe(true)
    if (result.success) {
      // New phase configs should have defaults
      expect(result.data.config.ground.max_review_rounds).toBe(2)
      expect(result.data.config.design.max_review_rounds).toBe(5)
      expect(result.data.config.experiment.max_optimize_rounds).toBe(3)
      expect(result.data.config.compose.max_revise_rounds).toBe(3)
      expect(result.data.config.realize.max_review_rounds).toBe(3)
      expect(result.data.config.stalled_days).toBe(7)
      // Old exploration fields preserved
      expect(result.data.config.exploration.depth).toBe("standard")
      expect(result.data.config.exploration.pilot).toBe("enabled")
      // New exploration fields get defaults
      expect(result.data.config.exploration.max_refine_rounds).toBe(3)
    }
  })

  test("old state with only exploration.depth/pilot gets new exploration defaults", () => {
    const oldState = {
      project: "legacy-v2",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      config: {
        participation_mode: "autonomous",
        exploration: { depth: "thorough", pilot: "skip" },
      },
      counters: { idea: 5, plan: 2, exp: 10, claim: 3, exh: 1, paper: 1, sub: 0 },
    }
    const result = StateYaml.safeParse(oldState)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.config.exploration.depth).toBe("thorough")
      expect(result.data.config.exploration.pilot).toBe("skip")
      expect(result.data.config.exploration.max_refine_rounds).toBe(3)
      expect(result.data.config.exploration.idea_select_score).toBe(8)
      expect(result.data.config.participation_mode).toBe("autonomous")
    }
  })
})
