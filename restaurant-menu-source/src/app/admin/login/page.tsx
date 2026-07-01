"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-ink py-2 text-cream font-medium hover:bg-ink/90 disabled:opacity-60"
    >
      {pending ? "Σύνδεση..." : "Σύνδεση"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState(login, { error: "" });

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <form
        action={formAction}
        className="w-full max-w-sm rounded-lg border border-ink/10 bg-white p-8 shadow-sm"
      >
        <h1 className="mb-1 text-xl font-serif font-semibold text-ink">Διαχείριση Μενού</h1>
        <p className="mb-6 text-sm text-ink/60">Συνδέσου με τον κωδικό διαχειριστή.</p>

        <label className="mb-1 block text-sm font-medium text-ink/80" htmlFor="password">
          Κωδικός
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          required
          className="mb-4 w-full rounded-md border border-ink/20 px-3 py-2 outline-none focus:border-accent"
        />

        {state?.error ? (
          <p className="mb-4 text-sm text-accent">{state.error}</p>
        ) : null}

        <SubmitButton />
      </form>
    </main>
  );
}
