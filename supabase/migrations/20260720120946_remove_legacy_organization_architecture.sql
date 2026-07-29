begin;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household_id uuid;
  registration jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_username text := lower(trim(coalesce(registration->>'username', '')));
begin
  if requested_username = '' then
    requested_username := 'u_' || substr(md5(new.id::text), 1, 28);
  end if;

  insert into public.households (created_by)
  values (new.id)
  returning id into new_household_id;

  insert into public.profiles (user_id, household_id, username, phone)
  values (
    new.id,
    new_household_id,
    requested_username,
    coalesce(registration->>'phone', '')
  );

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create or replace function public.claim_device(
  p_token_hash text,
  p_device_api_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.devices%rowtype;
begin
  update public.devices
  set status = 'online',
      last_seen = now(),
      claimed_at = now(),
      pairing_token_hash = null,
      device_api_key_hash = case when lower(type) = 'esp32' then p_device_api_key_hash else null end
  where pairing_token_hash = p_token_hash
    and claimed_at is null
    and pairing_expires_at >= now()
  returning * into claimed;

  if claimed.device_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'device_id', claimed.device_id,
    'household_id', claimed.household_id,
    'name', claimed.name,
    'type', claimed.type,
    'model', claimed.model,
    'assigned_space', claimed.assigned_space,
    'status', claimed.status,
    'mqtt_topic', claimed.mqtt_topic,
    'last_seen', claimed.last_seen,
    'created_at', claimed.created_at,
    'pairing_expires_at', claimed.pairing_expires_at,
    'claimed_at', claimed.claimed_at
  );
end;
$$;

revoke all on function public.claim_device(text, text) from public, anon, authenticated;
grant execute on function public.claim_device(text, text) to service_role;

drop policy if exists "members view organization" on public.organizations;
drop policy if exists "owners update organization" on public.organizations;
drop policy if exists "members view memberships" on public.organization_members;
drop policy if exists "members view profiles" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
drop policy if exists "members view devices" on public.devices;
drop policy if exists "members create devices" on public.devices;
drop policy if exists "members update devices" on public.devices;
drop policy if exists "members view voice intents" on public.voice_intents;
drop policy if exists "users create voice intents" on public.voice_intents;
drop policy if exists "users update voice intents" on public.voice_intents;
drop policy if exists "members view device commands" on public.device_commands;
drop policy if exists "users create device commands" on public.device_commands;
drop policy if exists "members update device commands" on public.device_commands;
drop policy if exists "members view device led states" on public.device_led_states;

drop trigger if exists profiles_sync_household_scope on public.profiles;
drop trigger if exists devices_sync_household_scope on public.devices;
drop trigger if exists voice_intents_sync_household_scope on public.voice_intents;
drop trigger if exists device_commands_sync_household_scope on public.device_commands;
drop trigger if exists device_led_states_sync_household_scope on public.device_led_states;
drop function if exists private.sync_household_scope_columns();

revoke all privileges on table public.profiles from anon, authenticated;
revoke all privileges on table public.devices from anon, authenticated;
revoke all privileges on table public.voice_intents from anon, authenticated;
revoke all privileges on table public.device_commands from anon, authenticated;
revoke all privileges on table public.device_led_states from anon, authenticated;

alter table public.profiles drop column organization_id;
alter table public.devices drop column organization_id;
alter table public.voice_intents drop column organization_id;
alter table public.device_commands drop column organization_id;
alter table public.device_led_states drop column organization_id;

drop function if exists private.is_organization_member(uuid);
drop table public.organization_members;
drop table public.organizations;

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'company_name'
where coalesce(raw_user_meta_data, '{}'::jsonb) ? 'company_name';

grant select, update on table public.profiles to authenticated;
grant select (
  device_id,
  household_id,
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
  household_id,
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
grant select on table public.device_led_states to authenticated;

commit;
