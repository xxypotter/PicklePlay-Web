import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/auth/session";
import RegisterForm from "./RegisterForm";

export const metadata = { title: "Create account · PicklePlay" };

export default async function RegisterPage() {
  if (await getCurrentPlayer()) redirect("/");

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <p className="mt-2 mb-8 text-[var(--muted)]">
        No email, no password, no DUPR login. Just a name and a PIN.
      </p>
      <RegisterForm />
    </main>
  );
}
