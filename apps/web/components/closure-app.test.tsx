import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClosureApp } from "./closure-app";

const GENERATION = {
  variations: [
    { angle: "Short and kind", message: "Sam, I've decided to end things between us." },
    { angle: "With a reason", message: "Sam, we want different futures, so I'm ending our relationship." },
    { angle: "Grateful", message: "Sam, thank you for everything. I'm ending things." },
  ],
};
const FULL = JSON.stringify(GENERATION);

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
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function completeWizard(user: ReturnType<typeof userEvent.setup>, medium = "Text message") {
  // Steps animate in/out, so wait for each to appear (findBy) as a user would.
  await user.click(await screen.findByLabelText("1–3 years"));
  await user.click(await screen.findByLabelText("We want different things"));
  await user.click(await screen.findByLabelText("Warm"));
  await user.click(await screen.findByLabelText(medium));
  await user.type(await screen.findByLabelText(/their name/i), "Sam");
  await user.click(screen.getByRole("button", { name: /write my messages/i }));
}

const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init!.body as string) as Record<string, string>);

describe("ClosureApp", () => {
  it("walks through the wizard, streams three cards, then offers actions", async () => {
    const user = userEvent.setup();
    const stream = controlledResponse();
    fetchMock.mockResolvedValueOnce(stream.response);
    render(<ClosureApp />);

    await completeWizard(user);
    expect(sentBodies()[0]).toEqual({
      duration: "1-3-years",
      reason: "different-goals",
      tone: "warm",
      medium: "text",
      name: "Sam",
    });

    // Mid-stream: partial text is visible, three card slots are reserved, no actions yet.
    stream.push(FULL.slice(0, 80));
    expect(await screen.findByText(/Sam, I've decided/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /writing your messages/i })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();

    stream.push(FULL.slice(80));
    stream.end();
    expect(await screen.findByRole("heading", { name: "Your messages" })).toBeInTheDocument();

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(within(cards[1]!).getByText("With a reason")).toBeInTheDocument();
    expect(within(cards[1]!).getByText(GENERATION.variations[1]!.message)).toBeInTheDocument();

    await user.click(within(cards[0]!).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(GENERATION.variations[0]!.message);
    expect(within(cards[0]!).getByRole("button", { name: "Copied" })).toBeInTheDocument();

    expect(within(cards[2]!).getByRole("link", { name: /open in messages/i })).toHaveAttribute(
      "href",
      `sms:?&body=${encodeURIComponent(GENERATION.variations[2]!.message)}`,
    );
  });

  it("regenerates with a different tone, keeping the other answers", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => Promise.resolve(new Response(FULL)));
    render(<ClosureApp />);

    await completeWizard(user);
    await user.click(await screen.findByRole("button", { name: "Direct" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBodies()[1]).toEqual({ ...sentBodies()[0], tone: "direct" });
    // The current tone isn't offered as a tweak.
    expect(await screen.findByRole("button", { name: "Warm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Direct" })).not.toBeInTheDocument();
  });

  it("offers an email link for emails and no send link for in-person", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => Promise.resolve(new Response(FULL)));
    const { unmount } = render(<ClosureApp />);

    await completeWizard(user, "Email");
    expect((await screen.findAllByRole("link", { name: /open in mail/i }))[0]).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:\?body=/),
    );
    unmount();

    render(<ClosureApp />);
    await completeWizard(user, "In person (talking points)");
    await screen.findByRole("heading", { name: "Your messages" });
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
    stream.push(FULL.slice(0, 80));
    await screen.findByText(/Sam, I've decided/);
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(await screen.findByRole("heading", { name: "Your messages" })).toBeInTheDocument();
    expect(screen.getByText(/Sam, I've decided/)).toBeInTheDocument();
  });

  it("starts over with the previous answers still selected", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response(FULL));
    render(<ClosureApp />);

    await completeWizard(user);
    await user.click(await screen.findByRole("button", { name: /start over/i }));

    expect(await screen.findByLabelText("1–3 years")).toBeChecked();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByLabelText("We want different things")).toBeChecked();
  });

  it("goes back a step without losing the selection", async () => {
    const user = userEvent.setup();
    render(<ClosureApp />);

    await user.click(screen.getByLabelText("6–12 months"));
    expect(await screen.findByRole("group", { name: /main reason/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(await screen.findByLabelText("6–12 months")).toBeChecked();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });
});
