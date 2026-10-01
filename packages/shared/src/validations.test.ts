import { describe, expect, it } from "vitest";
import { GenerationSchema, QuestionnaireSchema } from "./validations";

const VALID = { duration: "6-12-months", reason: "need-space", tone: "gentle", medium: "email" };

describe("QuestionnaireSchema", () => {
  it("accepts the required answers alone", () => {
    expect(QuestionnaireSchema.parse(VALID)).toEqual(VALID);
  });

  it("trims optional text and drops it when blank", () => {
    const parsed = QuestionnaireSchema.parse({ ...VALID, name: "  Sam ", details: "   " });
    expect(parsed).toEqual({ ...VALID, name: "Sam" });
    expect("details" in parsed && parsed.details !== undefined).toBe(false);
  });

  it("produces a fixed key order regardless of input order", () => {
    const a = QuestionnaireSchema.parse({ ...VALID, details: "d", name: "n" });
    const b = QuestionnaireSchema.parse({ name: "n", details: "d", medium: "email", tone: "gentle", reason: "need-space", duration: "6-12-months" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("strips unknown fields", () => {
    expect(QuestionnaireSchema.parse({ ...VALID, admin: true })).toEqual(VALID);
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
  it("accepts variations with an angle and a message", () => {
    const value = { variations: [{ angle: "Brief", message: "It's over." }] };
    expect(GenerationSchema.parse(value)).toEqual(value);
  });

  it("rejects variations missing a message", () => {
    expect(GenerationSchema.safeParse({ variations: [{ angle: "Brief" }] }).success).toBe(false);
  });
});
