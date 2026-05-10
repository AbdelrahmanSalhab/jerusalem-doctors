"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort — proceed to home regardless.
    }
    router.replace("/");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={submit}
      disabled={pending}
      className={className}
    >
      {pending ? "..." : "تسجيل الخروج"}
    </button>
  );
}
