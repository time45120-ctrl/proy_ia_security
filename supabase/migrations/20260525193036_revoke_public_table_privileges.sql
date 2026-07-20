-- Default API grants include TRUNCATE/TRIGGER/REFERENCES; RLS does not secure
-- TRUNCATE. Expose only operations intentionally used by signed-in clients.
revoke all privileges on table public.organizations from anon, authenticated;
revoke all privileges on table public.profiles from anon, authenticated;
revoke all privileges on table public.organization_members from anon, authenticated;
revoke all privileges on table public.devices from anon, authenticated;
revoke all privileges on table public.voice_intents from anon, authenticated;
revoke all privileges on table public.device_commands from anon, authenticated;

grant select, update on table public.organizations to authenticated;
grant select, update on table public.profiles to authenticated;
grant select on table public.organization_members to authenticated;
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
grant select on table public.device_commands to authenticated;
