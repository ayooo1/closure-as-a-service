import { describe, expect, it } from "vitest";
import {
  durationLabel,
  EndingSchema,
  GenerationSchema,
  PracticeRequestSchema,
  QuestionnaireSchema,
  REASON_LABELS,
  REASONS_BY_ENDING,
  RefineRequestSchema,
  RepliesRequestSchema,
  RepliesSchema,
} from "./validations";

const VALID = { duration: "6-12-months", reason: "need-space", tone: "gentle", medium: "email" };

describe("QuestionnaireSchema", () => {
  it("accepts the required answers alone, defaulting to a romantic relationship", () => {
    expect(QuestionnaireSchema.parse(VALID)).toEqual({ ending: "relationship", ...VALID });
  });

  it("only accepts reasons that fit the kind of ending", () => {
    expect(QuestionnaireSchema.safeParse({ ...VALID, ending: "friendship", reason: "grown-apart" }).success).toBe(true);
    const wrong = QuestionnaireSchema.safeParse({ ...VALID, ending: "friendship", reason: "long-distance" });
    expect(wrong.success).toBe(false);
    expect(wrong.error!.issues[0]!.path).toEqual(["reason"]);
    expect(QuestionnaireSchema.safeParse({ ...VALID, reason: "grown-apart" }).success).toBe(false); // not a romantic reason
  });

  it("offers every ending at least one reason plus 'Something else', each with a label", () => {
    for (const ending of EndingSchema.options) {
      expect(REASONS_BY_ENDING[ending]).toContain("other");
      for (const reason of REASONS_BY_ENDING[ending]) expect(REASON_LABELS[reason]).toBeTruthy();
    }
  });

  it("relabels 'A few dates' for friendships", () => {
    expect(durationLabel("friendship", "few-dates")).toBe("Not long");
    expect(durationLabel("relationship", "few-dates")).toBe("A few dates");
  });

  it("trims optional text and drops it when blank", () => {
    const parsed = QuestionnaireSchema.parse({ ...VALID, name: "  Sam ", details: "   " });
    expect(parsed).toEqual({ ending: "relationship", ...VALID, name: "Sam" });
    expect("details" in parsed && parsed.details !== undefined).toBe(false);
  });

  it("produces a fixed key order regardless of input order", () => {
    const a = QuestionnaireSchema.parse({ ...VALID, details: "d", name: "n" });
    const b = QuestionnaireSchema.parse({ name: "n", details: "d", medium: "email", tone: "gentle", reason: "need-space", duration: "6-12-months" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("strips unknown fields", () => {
    expect(QuestionnaireSchema.parse({ ...VALID, admin: true })).toEqual({ ending: "relationship", ...VALID });
  });

  it.each([
    ["missing duration", { ...VALID, duration: undefined }],
    ["unknown reason", { ...VALID, reason: "boredom" }],
    ["unknown medium", { ...VALID, medium: "carrier-pigeon" }],
    ["name over 40 chars", { ...VALID, name: "n".repeat(41) }],
    ["details over 500 chars", { ...VALID, details: "d".repeat(501) }],
  ])("rejects %s", (_label, input) => {
    expect(QuestionnaireSchema.safeParse(input).success).toBe(false);
  });

  it("measures length after trimming", () => {
    expect(QuestionnaireSchema.safeParse({ ...VALID, details: ` ${"d".repeat(500)} ` }).success).toBe(true);
  });
});

describe("GenerationSchema", () => {
  it("accepts a safety flag and variations with an angle and a message", () => {
    const value = { safetyConcern: false, variations: [{ angle: "Brief", message: "It's over." }] };
    expect(GenerationSchema.parse(value)).toEqual(value);
  });

  it("requires the safety flag", () => {
    expect(GenerationSchema.safeParse({ variations: [] }).success).toBe(false);
  });

  it("rejects variations missing a message", () => {
    expect(GenerationSchema.safeParse({ safetyConcern: false, variations: [{ angle: "Brief" }] }).success).toBe(false);
  });

  it("lists safetyConcern first, so it streams before the messages", () => {
    expect(Object.keys(GenerationSchema.shape)[0]).toBe("safetyConcern");
  });
});

describe("follow-up requests", () => {
  const message = "Sam, I'm ending things.";

  it("refine: validates the nested questionnaire, trims the message and checks the refinement", () => {
    const parsed = RefineRequestSchema.parse({ questionnaire: VALID, message: `  ${message} `, refinement: "softer" });
    expect(parsed).toEqual({ questionnaire: { ending: "relationship", ...VALID }, message, refinement: "softer" });
    expect(RefineRequestSchema.safeParse({ questionnaire: VALID, message, refinement: "meaner" }).success).toBe(false);
  });

  it("replies: requires a non-empty message of at most 2000 characters", () => {
    expect(RepliesRequestSchema.safeParse({ questionnaire: VALID, message }).success).toBe(true);
    expect(RepliesRequestSchema.safeParse({ questionnaire: VALID, message: "  " }).success).toBe(false);
    expect(RepliesRequestSchema.safeParse({ questionnaire: VALID, message: "x".repeat(2001) }).success).toBe(false);
    expect(RepliesRequestSchema.safeParse({ message }).success).toBe(false);
  });

  it("replies output pairs what they say with what you can say", () => {
    const value = { replies: [{ theySay: "Why?", youCanSay: "We want different things." }] };
    expect(RepliesSchema.parse(value)).toEqual(value);
    expect(RepliesSchema.safeParse({ replies: [{ theySay: "Why?" }] }).success).toBe(false);
  });
});

describe("PracticeRequestSchema", () => {
  const base = { questionnaire: VALID, message: "It's over." };
  it("accepts an opening request and an alternating conversation ending on the user", () => {
    expect(PracticeRequestSchema.safeParse({ ...base, turns: [] }).success).toBe(true);
    const turns = [
      { role: "them", text: "Why?" },
      { role: "you", text: "I've decided." },
    ];
    expect(PracticeRequestSchema.safeParse({ ...base, turns }).success).toBe(true);
  });

  it("rejects replies over 1000 characters", () => {
    const turns = [
      { role: "them", text: "Why?" },
      { role: "you", text: "x".repeat(1001) },
    ];
    expect(PracticeRequestSchema.safeParse({ ...base, turns }).success).toBe(false);
  });
});
