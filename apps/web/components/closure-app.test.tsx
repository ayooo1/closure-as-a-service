import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClosureApp } from "./closure-app";

const GENERATION = {
  safetyConcern: false,
  variations: [
    { angle: "Short and kind", message: "Sam, I've decided to end things between us." },
    { angle: "With a reason", message: "Sam, we want different futures, so I'm ending our relationship." },
    { angle: "Grateful", message: "Sam, thank you for everything. I'm ending things." },
  ],
};
const FULL = JSON.stringify(GENERATION);
const REFINED = "Sam, I'm ending things.";
const LOGISTICS = "Could you let me know a time that works for you to collect your things?";
const REPLIES = {
  replies: [
    { theySay: "Can we talk about this?", youCanSay: "I've thought it through, and my decision is final." },
    { theySay: "Why?", youCanSay: "We want different things. I'm sorry." },
  ],
};

/** A response whose body the test feeds chunk by chunk. */
function controlledResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  return {
    response: new Response(body),
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end: () => controller.close(),
  };
}

const fetchMock = vi.fn<typeof fetch>();
/** Answers each API route with a fixed body (status 200) unless a test overrides it. */
type Route = "/api/generate" | "/api/refine" | "/api/replies" | "/api/feedback" | "/api/logistics";
function fakeApi(routes: Partial<Record<Route, string | Response>> = {}) {
  const bodies = {
    "/api/generate": FULL,
    "/api/refine": JSON.stringify({ message: REFINED }),
    "/api/replies": JSON.stringify(REPLIES),
    "/api/feedback": "",
    "/api/logistics": JSON.stringify({ message: LOGISTICS }),
    ...routes,
  };
  fetchMock.mockImplementation((url) => {
    const body = bodies[url as keyof typeof bodies];
    return Promise.resolve(body instanceof Response ? body : new Response(body));
  });
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function completeWizard(user: ReturnType<typeof userEvent.setup>, medium = "Text message") {
  // Steps animate in/out, so wait for each to appear (findBy) as a user would.
  await user.click(await screen.findByLabelText("A relationship"));
  await user.click(await screen.findByLabelText("1–3 years"));
  await user.click(await screen.findByLabelText("We want different things"));
  await user.click(await screen.findByLabelText("Warm"));
  await user.click(await screen.findByLabelText(medium));
  await user.type(await screen.findByLabelText(/their name/i), "Sam");
  await user.click(screen.getByRole("button", { name: /write my messages/i }));
}

const requests = (url: string) =>
  fetchMock.mock.calls
    .filter(([u]) => u === url)
    .map(([, init]) => JSON.parse(init!.body as string) as Record<string, unknown>);

async function resultCards() {
  await screen.findByRole("heading", { name: "Your messages" });
  return screen.getAllByRole("article");
}

describe("ClosureApp", () => {
  it("walks through the wizard, streams three cards, then offers actions", async () => {
    const user = userEvent.setup();
    const stream = controlledResponse();
    fetchMock.mockResolvedValueOnce(stream.response);
    render(<ClosureApp />);

    await completeWizard(user);
    expect(requests("/api/generate")[0]).toEqual({
      ending: "relationship",
      duration: "1-3-years",
      reason: "different-goals",
      tone: "warm",
      medium: "text",
      name: "Sam",
    });

    // Mid-stream: partial text is visible, three card slots are reserved, no actions yet.
    stream.push(FULL.slice(0, 100));
    expect(await screen.findByText(/Sam, I've decided/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /writing your messages/i })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();

    stream.push(FULL.slice(100));
    stream.end();
    const cards = await resultCards();
    expect(cards).toHaveLength(3);
    expect(within(cards[1]!).getByText("With a reason")).toBeInTheDocument();
    expect(within(cards[1]!).getByText(GENERATION.variations[1]!.message)).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: /safety/i })).not.toBeInTheDocument();

    await user.click(within(cards[0]!).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(GENERATION.variations[0]!.message);
    expect(within(cards[0]!).getByRole("button", { name: "Copied" })).toBeInTheDocument();

    expect(within(cards[2]!).getByRole("link", { name: /open in messages/i })).toHaveAttribute(
      "href",
      `sms:?&body=${encodeURIComponent(GENERATION.variations[2]!.message)}`,
    );
  });

  it("tells the user their name and details aren't saved", async () => {
    const user = userEvent.setup();
    render(<ClosureApp />);
    for (const label of ["A relationship", "1–3 years", "We want different things", "Warm", "Text message"]) {
      await user.click(await screen.findByLabelText(label));
    }
    expect(await screen.findByText(/we don't save your name or details/i)).toBeInTheDocument();
  });

  it("regenerates with a different tone, keeping the other answers", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);

    await completeWizard(user);
    await user.click(await screen.findByRole("button", { name: "Direct" }));

    await waitFor(() => expect(requests("/api/generate")).toHaveLength(2));
    expect(requests("/api/generate")[1]).toEqual({ ...requests("/api/generate")[0], tone: "direct" });
    // The current tone isn't offered as a tweak.
    expect(await screen.findByRole("button", { name: "Warm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Direct" })).not.toBeInTheDocument();
  });

  it("offers an email link for emails and no send link for in-person", async () => {
    const user = userEvent.setup();
    fakeApi();
    const { unmount } = render(<ClosureApp />);

    await completeWizard(user, "Email");
    expect((await screen.findAllByRole("link", { name: /open in mail/i }))[0]).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:\?body=/),
    );
    unmount();

    render(<ClosureApp />);
    await completeWizard(user, "In person (talking points)");
    await resultCards();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the wait time when rate limited, without a retry button", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "30" } }));
    render(<ClosureApp />);

    await completeWizard(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again in 30s/i);
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("lets the user retry after a failure", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 502 })).mockResolvedValueOnce(new Response(FULL));
    render(<ClosureApp />);

    await completeWizard(user);
    await user.click(await screen.findByRole("button", { name: /try again/i }));

    expect(await screen.findByText(GENERATION.variations[0]!.message)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stops generating on request, keeping what was written", async () => {
    const user = userEvent.setup();
    const stream = controlledResponse();
    fetchMock.mockImplementationOnce((_url, init) => {
      init!.signal!.addEventListener("abort", () => stream.end());
      return Promise.resolve(stream.response);
    });
    render(<ClosureApp />);

    await completeWizard(user);
    stream.push(FULL.slice(0, 100));
    await screen.findByText(/Sam, I've decided/);
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(await screen.findByRole("heading", { name: "Your messages" })).toBeInTheDocument();
    expect(screen.getByText(/Sam, I've decided/)).toBeInTheDocument();
  });

  it("starts over with the previous answers still selected", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);

    await completeWizard(user);
    await user.click(await screen.findByRole("button", { name: /start over/i }));

    expect(await screen.findByLabelText("A relationship")).toBeChecked();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByLabelText("1–3 years")).toBeChecked();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByLabelText("We want different things")).toBeChecked();
  });

  it("goes back a step without losing the selection", async () => {
    const user = userEvent.setup();
    render(<ClosureApp />);

    await user.click(screen.getByLabelText("A relationship"));
    await user.click(await screen.findByLabelText("6–12 months"));
    expect(await screen.findByRole("group", { name: /main reason/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(await screen.findByLabelText("6–12 months")).toBeChecked();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  });
});

describe("kinds of endings", () => {
  it("adapts the questions to a friendship and sends the ending", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);

    await user.click(await screen.findByLabelText("A friendship"));
    expect(await screen.findByRole("group", { name: "How long have you been friends?" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Not long"));
    const reasons = await screen.findByRole("group", { name: "What's the main reason?" });
    expect(within(reasons).getByLabelText("It feels one-sided")).toBeInTheDocument();
    expect(within(reasons).queryByLabelText("The spark is gone")).not.toBeInTheDocument();
    await user.click(within(reasons).getByLabelText("It feels one-sided"));
    await user.click(await screen.findByLabelText("Gentle"));
    await user.click(await screen.findByLabelText("Text message"));
    await user.click(await screen.findByRole("button", { name: /write my messages/i }));

    await waitFor(() => expect(requests("/api/generate")).toHaveLength(1));
    expect(requests("/api/generate")[0]).toMatchObject({ ending: "friendship", duration: "few-dates", reason: "one-sided" });
  });

  it("asks what you want to say when replying to a breakup", async () => {
    const user = userEvent.setup();
    render(<ClosureApp />);

    await user.click(await screen.findByLabelText("Replying to a breakup"));
    await user.click(await screen.findByLabelText("1–3 years"));
    expect(await screen.findByRole("group", { name: "What do you want to say?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ask for a little closure")).toBeInTheDocument();
  });

  it("clears a reason that doesn't fit when the ending changes", async () => {
    const user = userEvent.setup();
    render(<ClosureApp />);

    await user.click(await screen.findByLabelText("A relationship"));
    await user.click(await screen.findByLabelText("1–3 years"));
    await user.click(await screen.findByLabelText("Distance is too hard"));
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(await screen.findByLabelText("A friendship"));
    await user.click(screen.getByRole("button", { name: /next/i }));

    const reasons = await screen.findByRole("group", { name: "What's the main reason?" });
    expect(within(reasons).getAllByRole("radio").filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });
});

describe("safety", () => {
  it("shows safety guidance and helplines, and hides reply coaching", async () => {
    const user = userEvent.setup();
    fakeApi({ "/api/generate": JSON.stringify({ ...GENERATION, safetyConcern: true }) });
    render(<ClosureApp />);

    await completeWizard(user);
    await resultCards();
    const notice = screen.getByRole("complementary", { name: /your safety comes first/i });
    expect(within(notice).getByText(/call your local emergency number/i)).toBeInTheDocument();
    expect(within(notice).getByRole("link", { name: "findahelpline.com" })).toHaveAttribute("href", "https://findahelpline.com");
    expect(screen.queryByRole("button", { name: /what if they reply/i })).not.toBeInTheDocument();
  });

  it("turns in-person talking points into messages to send from a safe place", async () => {
    const user = userEvent.setup();
    fakeApi({ "/api/generate": JSON.stringify({ ...GENERATION, safetyConcern: true }) });
    render(<ClosureApp />);

    await completeWizard(user, "In person (talking points)");
    const cards = await resultCards();
    expect(within(cards[0]!).getByRole("link", { name: /open in messages/i })).toBeInTheDocument();
  });
});

describe("refining one message", () => {
  it("edits a message by hand; copy uses the edit and undo restores the original", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);
    await completeWizard(user);
    const card = (await resultCards())[0]!;

    await user.click(within(card).getByRole("button", { name: "Edit" }));
    const editor = within(card).getByRole("textbox", { name: "Edit message" });
    await user.clear(editor);
    await user.type(editor, "Sam, this is goodbye.");
    await user.click(within(card).getByRole("button", { name: "Done" }));

    expect(within(card).getByText("Sam, this is goodbye.")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe("Sam, this is goodbye.");

    await user.click(within(card).getByRole("button", { name: "Undo" }));
    expect(within(card).getByText(GENERATION.variations[0]!.message)).toBeInTheDocument();
  });

  it("rewrites a message with Claude, sending the current text and the chosen change", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);
    await completeWizard(user);
    const card = (await resultCards())[1]!;

    await user.click(within(card).getByRole("button", { name: "Rewrite" }));
    await user.click(within(card).getByRole("button", { name: "Without the reason" }));

    expect(await within(card).findByText(REFINED)).toBeInTheDocument();
    expect(requests("/api/refine")[0]).toMatchObject({
      message: GENERATION.variations[1]!.message,
      refinement: "without-reason",
      questionnaire: { tone: "warm", name: "Sam" },
    });
    // The other cards are untouched.
    expect(screen.getByText(GENERATION.variations[0]!.message)).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Undo" }));
    expect(within(card).getByText(GENERATION.variations[1]!.message)).toBeInTheDocument();
  });

  it("keeps the original message if a rewrite fails", async () => {
    const user = userEvent.setup();
    fakeApi({ "/api/refine": new Response("{}", { status: 502 }) });
    render(<ClosureApp />);
    await completeWizard(user);
    const card = (await resultCards())[0]!;

    await user.click(within(card).getByRole("button", { name: "Rewrite" }));
    await user.click(within(card).getByRole("button", { name: "Shorter" }));

    expect(await within(card).findByRole("alert")).toHaveTextContent(/couldn't write that/i);
    expect(within(card).getByText(GENERATION.variations[0]!.message)).toBeInTheDocument();
  });
});

describe("what if they reply", () => {
  it("shows likely replies with calm responses for the chosen message", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);
    await completeWizard(user);
    const card = (await resultCards())[2]!;

    await user.click(within(card).getByRole("button", { name: /what if they reply/i }));

    expect(await within(card).findByText("Can we talk about this?")).toBeInTheDocument();
    expect(within(card).getByText(REPLIES.replies[0]!.youCanSay)).toBeInTheDocument();
    expect(within(card).getByText(REPLIES.replies[1]!.youCanSay)).toBeInTheDocument();
    expect(requests("/api/replies")[0]).toMatchObject({ message: GENERATION.variations[2]!.message });
  });

  it("clears reply suggestions when the message is rewritten", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);
    await completeWizard(user);
    const card = (await resultCards())[0]!;

    await user.click(within(card).getByRole("button", { name: /what if they reply/i }));
    await within(card).findByText("Can we talk about this?");
    await user.click(within(card).getByRole("button", { name: "Rewrite" }));
    await user.click(within(card).getByRole("button", { name: "Shorter" }));

    await within(card).findByText(REFINED);
    expect(within(card).queryByText("Can we talk about this?")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /what if they reply/i })).toBeInTheDocument();
  });
});

describe("voting", () => {
  it("sends a 👍 with the answer categories only, then locks the buttons", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);
    await completeWizard(user);
    const card = (await resultCards())[0]!;

    await user.click(within(card).getByRole("button", { name: "Helpful" }));

    await waitFor(() => expect(requests("/api/feedback")).toHaveLength(1));
    expect(requests("/api/feedback")[0]).toEqual({
      vote: "up",
      ending: "relationship",
      duration: "1-3-years",
      reason: "different-goals",
      tone: "warm",
      medium: "text",
      changed: false,
      safetyConcern: false,
    });
    expect(JSON.stringify(requests("/api/feedback")[0])).not.toContain("Sam"); // no name or message text
    expect(within(card).getByText("Thanks!")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("button", { name: "Not helpful" })).toBeDisabled();
  });

  it("marks votes on rewritten messages as changed", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);
    await completeWizard(user);
    const card = (await resultCards())[0]!;

    await user.click(within(card).getByRole("button", { name: "Rewrite" }));
    await user.click(within(card).getByRole("button", { name: "Shorter" }));
    await within(card).findByText(REFINED);
    await user.click(within(card).getByRole("button", { name: "Not helpful" }));

    await waitFor(() => expect(requests("/api/feedback")[0]).toMatchObject({ vote: "down", changed: true }));
  });

  it("still thanks the user if the vote can't be recorded", async () => {
    const user = userEvent.setup();
    fakeApi({ "/api/feedback": new Response("{}", { status: 503 }) });
    render(<ClosureApp />);
    await completeWizard(user);
    const card = (await resultCards())[0]!;

    await user.click(within(card).getByRole("button", { name: "Helpful" }));
    expect(within(card).getByText("Thanks!")).toBeInTheDocument();
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("logistics", () => {
  it("writes a follow-up about the chosen shared things", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);
    await completeWizard(user);
    await resultCards();

    await user.click(screen.getByRole("button", { name: /sort out belongings or shared things/i }));
    const panel = screen.getByRole("region", { name: "Sort out shared things" });
    const write = within(panel).getByRole("button", { name: "Write the message" });
    expect(write).toBeDisabled(); // nothing picked yet

    await user.click(within(panel).getByLabelText("Returning belongings"));
    await user.click(within(panel).getByLabelText("Pets"));
    await user.type(within(panel).getByLabelText(/anything specific/i), "The cat stays with me");
    await user.click(write);

    expect(await within(panel).findByText(LOGISTICS)).toBeInTheDocument();
    expect(requests("/api/logistics")[0]).toMatchObject({
      topics: ["belongings", "pets"],
      notes: "The cat stays with me",
      safetyConcern: false,
      questionnaire: { name: "Sam", tone: "warm" },
    });
    expect(within(panel).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /open in messages/i })).toBeInTheDocument();
  });

  it("asks for handovers without meeting when there's a safety concern", async () => {
    const user = userEvent.setup();
    fakeApi({ "/api/generate": JSON.stringify({ ...GENERATION, safetyConcern: true }) });
    render(<ClosureApp />);
    await completeWizard(user);
    await resultCards();

    await user.click(screen.getByRole("button", { name: /sort out belongings/i }));
    const panel = screen.getByRole("region", { name: "Sort out shared things" });
    expect(within(panel).getByText(/don't need you to meet/i)).toBeInTheDocument();
    await user.click(within(panel).getByLabelText("Returning belongings"));
    await user.click(within(panel).getByRole("button", { name: "Write the message" }));

    await waitFor(() => expect(requests("/api/logistics")[0]).toMatchObject({ safetyConcern: true }));
  });

  it("isn't offered for a ghosting apology", async () => {
    const user = userEvent.setup();
    fakeApi();
    render(<ClosureApp />);
    for (const label of ["Apologising for ghosting someone", "A few dates", "I avoided a hard conversation", "Gentle", "Text message"]) {
      await user.click(await screen.findByLabelText(label));
    }
    await user.click(await screen.findByRole("button", { name: /write my messages/i }));

    await resultCards();
    expect(screen.queryByRole("button", { name: /sort out belongings/i })).not.toBeInTheDocument();
  });
});
