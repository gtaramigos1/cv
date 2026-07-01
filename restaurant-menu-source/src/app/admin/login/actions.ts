"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/auth";

export async function login(_prevState: { error: string }, formData: FormData) {
  const password = formData.get("password");

  if (typeof password !== "string" || password.length === 0) {
    return { error: "Συμπλήρωσε τον κωδικό." };
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return { error: "Λάθος κωδικός." };
  }

  const token = await createSessionToken();
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  redirect("/admin");
}

export async function logout() {
  cookies().delete(COOKIE_NAME);
  redirect("/admin/login");
}
