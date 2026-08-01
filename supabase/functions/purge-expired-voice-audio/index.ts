import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function readDefaultSecretKey() {
  const namedKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (namedKeys) {
    try {
      const parsed = JSON.parse(namedKeys) as Record<string, string>;
      if (parsed.default) {
        return parsed.default;
      }
    } catch {
      // Continue with the single-key and legacy fallbacks used by local setups.
    }
  }

  return (
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = readDefaultSecretKey();
  if (!url || !serviceKey) {
    return Response.json({ error: "Supabase environment is incomplete." }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: expired, error: selectError } = await supabase
    .from("voice_intents")
    .select("request_id,audio_path")
    .not("audio_path", "is", null)
    .is("audio_purged_at", null)
    .lte("audio_expires_at", new Date().toISOString())
    .limit(1000);

  if (selectError) {
    return Response.json({ error: selectError.message }, { status: 500 });
  }

  const paths = (expired ?? [])
    .map((record) => record.audio_path)
    .filter((path): path is string => Boolean(path));
  if (paths.length === 0) {
    return Response.json({ purged: 0 });
  }

  const { error: removeError } = await supabase.storage.from("voice-audio").remove(paths);
  if (removeError) {
    return Response.json({ error: removeError.message }, { status: 500 });
  }

  const ids = (expired ?? []).map((record) => record.request_id);
  const { error: updateError } = await supabase
    .from("voice_intents")
    .update({ audio_purged_at: new Date().toISOString(), audio_path: null })
    .in("request_id", ids);
  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  return Response.json({ purged: ids.length });
});
