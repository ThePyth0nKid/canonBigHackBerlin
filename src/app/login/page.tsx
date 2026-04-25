import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/app");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Canon</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Connect an identity to start signing facts.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/app" });
            }}
          >
            <button
              type="submit"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Continue with GitHub
            </button>
          </form>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/app" });
            }}
          >
            <button
              type="submit"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Continue with Google
            </button>
          </form>
        </div>

        <p className="mt-6 text-xs leading-relaxed text-zinc-500">
          By continuing you agree that Canon stores signed facts derived from
          your connected sources. Data stays in EU infrastructure.
        </p>
      </div>
    </main>
  );
}
