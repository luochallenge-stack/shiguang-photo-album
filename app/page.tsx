import { cookies } from "next/headers";
import AlbumClient from "./album-client";
import LoginScreen from "./login-screen";
import { publicUser, sessionCookieName, userFromSessionToken } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const user = await userFromSessionToken(cookieStore.get(sessionCookieName())?.value || "");
  if (!user) return <LoginScreen />;
  return <AlbumClient initialUser={publicUser(user)} />;
}
