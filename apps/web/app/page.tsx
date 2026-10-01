import { ClosureApp } from "@/components/closure-app";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-20">
      <header className="space-y-3 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">Closure as a Service</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Endings are hard. The message doesn&apos;t have to be.
        </h1>
        <p className="text-muted-foreground text-balance">
          Answer a few questions and get three thoughtful ways to say goodbye.
        </p>
      </header>
      <ClosureApp />
    </main>
  );
}
