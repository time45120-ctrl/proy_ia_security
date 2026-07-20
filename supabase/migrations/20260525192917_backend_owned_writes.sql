-- Browsers read tenant-safe records under RLS; FastAPI owns sensitive writes.
revoke select, insert, update, delete on table public.devices from anon, authenticated;
grant select (
  device_id,
  organization_id,
  created_by,
  name,
  type,
  model,
  assigned_space,
  status,
  mqtt_topic,
  last_seen,
  created_at,
  pairing_expires_at,
  claimed_at
) on table public.devices to authenticated;

revoke insert, update, delete on table public.voice_intents from anon, authenticated;
revoke select on table public.voice_intents from anon, authenticated;
grant select (
  request_id,
  organization_id,
  user_id,
  filename,
  content_type,
  audio_expires_at,
  audio_purged_at,
  transcription,
  ai_provider,
  response_for_user,
  device_intent,
  plan,
  status,
  expires_at,
  confirmed_at,
  created_at
) on table public.voice_intents to authenticated;

revoke insert, update, delete on table public.device_commands from anon, authenticated;
revoke select on table public.device_commands from anon, authenticated;
grant select on table public.device_commands to authenticated;
