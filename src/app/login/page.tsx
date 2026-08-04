import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth/session";
import LoginForm from "./LoginForm";

export const metadata = { title: "Log in · PicklePlay" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (await getCurrentPlayer()) redirect(next?.startsWith("/") ? next : "/");

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10">
      <h1 className="text-2xl font-bold">Welcome back</h1>
      <p className="mt-2 mb-8 text-[var(--muted)]">Log in with your name and PIN.</p>
      <LoginForm next={next ?? ""} />
    </main>
  );
}
