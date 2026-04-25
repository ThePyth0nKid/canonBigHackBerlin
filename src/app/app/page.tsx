import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="flex flex-1 flex-col px-6 py-16">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Your workspace
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Signed in as {session.user.email}
            </p>
          </div>

          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Sign out
            </button>
          </form>
        </div>

        <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <p className="text-sm text-zinc-500">
            No facts yet. Connect a source to start.
          </p>
          <p className="mt-4 font-mono text-xs text-zinc-400">
            [ingest UI — built during BBH demo ]
          </p>
        </div>
      </div>
    </main>
  );
}
