import { z } from "zod";

// Each option list is a Zod enum (for validation) plus a label map (for the wizard UI).
// The Record<…> types make the label maps exhaustive: adding an enum value without a label fails typecheck.

export const DurationSchema = z.enum(["few-dates", "under-6-months", "6-12-months", "1-3-years", "3-plus-years"]);
export type Duration = z.infer<typeof DurationSchema>;
export const DURATION_LABELS: Record<Duration, string> = {
  "few-dates": "A few dates",
  "under-6-months": "Less than 6 months",
  "6-12-months": "6–12 months",
  "1-3-years": "1–3 years",
  "3-plus-years": "3+ years",
};

export const ReasonSchema = z.enum([
  "lost-spark",
  "different-goals",
  "need-space",
  "incompatible",
  "long-distance",
  "not-ready",
  "other",
]);
export type Reason = z.infer<typeof ReasonSchema>;
export const REASON_LABELS: Record<Reason, string> = {
  "lost-spark": "The spark is gone",
  "different-goals": "We want different things",
  "need-space": "I need to focus on myself",
  incompatible: "We're not compatible",
  "long-distance": "Distance is too hard",
  "not-ready": "I'm not ready for a relationship",
  other: "Something else",
};

export const ToneSchema = z.enum(["gentle", "direct", "warm", "formal", "lighthearted"]);
export type Tone = z.infer<typeof ToneSchema>;
export const TONE_LABELS: Record<Tone, string> = {
  gentle: "Gentle",
  direct: "Direct",
  warm: "Warm",
  formal: "Formal",
  lighthearted: "Lighthearted",
};

export const MediumSchema = z.enum(["text", "email", "in-person"]);
export type Medium = z.infer<typeof MediumSchema>;
export const MEDIUM_LABELS: Record<Medium, string> = {
  text: "Text message",
  email: "Email",
  "in-person": "In person (talking points)",
};

export const DETAILS_MAX_LENGTH = 500;
export const NAME_MAX_LENGTH = 40;

// Empty strings from untouched form fields become undefined, so they don't fragment the cache key.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

export const QuestionnaireSchema = z.object({
  duration: DurationSchema,
  reason: ReasonSchema,
  tone: ToneSchema,
  medium: MediumSchema,
  name: optionalText(NAME_MAX_LENGTH),
  details: optionalText(DETAILS_MAX_LENGTH),
});
/** What the API accepts (and the form produces). */
export type QuestionnaireInput = z.input<typeof QuestionnaireSchema>;
/** What the API works with after validation. */
export type Questionnaire = z.output<typeof QuestionnaireSchema>;

export const VARIATION_COUNT = 3;

// Streamed by POST /api/generate as JSON text; the web app parses it incrementally.
// No array length constraint: provider structured-output modes vary in support for it, so
// the count is enforced via the prompt and the UI renders at most VARIATION_COUNT.
export const GenerationSchema = z.object({
  // First, so the UI can show safety guidance before the messages finish streaming.
  safetyConcern: z
    .boolean()
    .describe("True only if the details suggest the user may be at risk of harm from this person"),
  variations: z
    .array(
      z.object({
        angle: z.string().describe("A 2-4 word label for this variation's approach"),
        message: z.string().describe("The message itself, ready to send or say"),
      }),
    )
    .describe(`Exactly ${VARIATION_COUNT} distinct variations`),
});
export type Generation = z.infer<typeof GenerationSchema>;

// ---- Follow-ups on one chosen message ----

export const MESSAGE_MAX_LENGTH = 2000;
const MessageText = z.string().trim().min(1).max(MESSAGE_MAX_LENGTH);

export const RefinementSchema = z.enum(["shorter", "softer", "more-direct", "warmer", "without-reason"]);
export type Refinement = z.infer<typeof RefinementSchema>;
export const REFINEMENT_LABELS: Record<Refinement, string> = {
  shorter: "Shorter",
  softer: "Softer",
  "more-direct": "More direct",
  warmer: "Warmer",
  "without-reason": "Without the reason",
};

/** POST /api/refine: rewrite one message. */
export const RefineRequestSchema = z.object({
  questionnaire: QuestionnaireSchema,
  message: MessageText,
  refinement: RefinementSchema,
});
export type RefineRequest = z.input<typeof RefineRequestSchema>;

export const RefinedSchema = z.object({
  message: z.string().describe("The rewritten message, ready to send or say"),
});
export type Refined = z.infer<typeof RefinedSchema>;

/** POST /api/replies: likely responses to a sent message, and how to answer each. */
export const RepliesRequestSchema = z.object({
  questionnaire: QuestionnaireSchema,
  message: MessageText,
});
export type RepliesRequest = z.input<typeof RepliesRequestSchema>;

export const REPLY_COUNT = 4;
export const RepliesSchema = z.object({
  replies: z
    .array(
      z.object({
        theySay: z.string().describe("A realistic reply they might send, in their voice"),
        youCanSay: z.string().describe("A calm, kind response that holds the decision"),
      }),
    )
    .describe(`Exactly ${REPLY_COUNT} different likely replies`),
});
export type Replies = z.infer<typeof RepliesSchema>;
