import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

export async function getAccessToken() {
  const {
    data: { session },
  } = await createClient().auth.getSession();

  return session?.access_token ?? null;
}
