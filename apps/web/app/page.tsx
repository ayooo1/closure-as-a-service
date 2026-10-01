export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-primary">
        Closure as a Service
      </p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Endings are hard. The message doesn&apos;t have to be.
      </h1>
      <p className="text-muted-foreground">
        {/* The questionnaire wizard lands here in a later step. */}
        Answer a few questions and get three thoughtful ways to say goodbye.
      </p>
    </main>
  );
}
