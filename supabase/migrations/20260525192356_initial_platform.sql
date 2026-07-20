create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  operation_size text not null default '26-100'
    check (operation_size in ('1-25', '26-100', '101-500', '500+')),
  primary_need text not null default 'integral'
    check (primary_need in ('camaras', 'accesos', 'luces', 'drones', 'integral')),
  source text not null default 'afcr-welcome-mvp',
  created_by uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_name text not null default '',
  role_title text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.devices (
  device_id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  model text not null,
  assigned_space text check (
    assigned_space is null or assigned_space in ('sala', 'comedor', 'cocina', 'cuarto_principal')
  ),
  status text not null default 'pending'
    check (status in ('pending', 'online', 'offline', 'linked')),
  mqtt_topic text not null,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  pairing_token_hash text,
  pairing_expires_at timestamptz,
  claimed_at timestamptz,
  device_api_key_hash text
);

create table public.voice_intents (
  request_id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  content_type text not null default '',
  audio_path text,
  audio_expires_at timestamptz,
  audio_purged_at timestamptz,
  transcription text not null default '',
  ai_provider text not null,
  response_for_user text not null default '',
  device_intent jsonb not null default '{}'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation', 'confirmed', 'not_executable', 'queued', 'executed', 'failed', 'expired')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.device_commands (
  command_id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id text not null references public.devices(device_id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  target text not null,
  action text not null,
  espacio text not null check (espacio in ('sala', 'comedor', 'cocina', 'cuarto_principal')),
  status text not null check (status in ('queued', 'delivered', 'executed', 'failed', 'expired')),
  source_request_id text references public.voice_intents(request_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz,
  ack_at timestamptz,
  failure_detail text
);

create index devices_organization_created_idx on public.devices (organization_id, created_at desc);
create index devices_pairing_hash_idx on public.devices (pairing_token_hash)
  where pairing_token_hash is not null;
create index devices_delivery_lookup_idx on public.devices (organization_id, type, assigned_space, claimed_at desc);
create index device_commands_delivery_idx on public.device_commands (device_id, status, created_at);
create index device_commands_org_created_idx on public.device_commands (organization_id, created_at desc);
create index voice_intents_org_created_idx on public.voice_intents (organization_id, created_at desc);
create index voice_intents_audio_expiry_idx on public.voice_intents (audio_expires_at)
  where audio_path is not null and audio_purged_at is null;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.devices enable row level security;
alter table public.voice_intents enable row level security;
alter table public.device_commands enable row level security;

create or replace function private.is_organization_member(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization
      and membership.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_organization_member(uuid) from public;
grant execute on function private.is_organization_member(uuid) to authenticated;

create policy "members view organization"
  on public.organizations for select to authenticated
  using ((select private.is_organization_member(id)));

create policy "owners update organization"
  on public.organizations for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy "members view profiles"
  on public.profiles for select to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy "users update own profile"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (select private.is_organization_member(organization_id))
  );

create policy "members view memberships"
  on public.organization_members for select to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy "members view devices"
  on public.devices for select to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy "members create devices"
  on public.devices for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.is_organization_member(organization_id))
  );

create policy "members update devices"
  on public.devices for update to authenticated
  using ((select private.is_organization_member(organization_id)))
  with check ((select private.is_organization_member(organization_id)));

create policy "members view voice intents"
  on public.voice_intents for select to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy "users create voice intents"
  on public.voice_intents for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.is_organization_member(organization_id))
  );

create policy "users update voice intents"
  on public.voice_intents for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.is_organization_member(organization_id))
  )
  with check (
    user_id = (select auth.uid())
    and (select private.is_organization_member(organization_id))
  );

create policy "members view device commands"
  on public.device_commands for select to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy "users create device commands"
  on public.device_commands for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.is_organization_member(organization_id))
  );

create policy "members update device commands"
  on public.device_commands for update to authenticated
  using ((select private.is_organization_member(organization_id)))
  with check ((select private.is_organization_member(organization_id)));

create or replace function private.sync_voice_command_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_request_id is not null and new.status in ('executed', 'failed', 'expired') then
    update public.voice_intents
    set status = new.status
    where request_id = new.source_request_id;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_voice_command_status() from public, anon, authenticated;
create trigger device_command_updates_voice_intent
  after update of status on public.device_commands
  for each row execute function private.sync_voice_command_status();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  registration jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  operation_value text;
  need_value text;
begin
  operation_value := case registration->>'operation_size'
    when '1-25' then '1-25'
    when '26-100' then '26-100'
    when '101-500' then '101-500'
    when '500+' then '500+'
    else '26-100'
  end;
  need_value := case registration->>'primary_need'
    when 'camaras' then 'camaras'
    when 'accesos' then 'accesos'
    when 'luces' then 'luces'
    when 'drones' then 'drones'
    else 'integral'
  end;

  insert into public.organizations (name, operation_size, primary_need, source, created_by)
  values (
    coalesce(nullif(trim(registration->>'company_name'), ''), split_part(new.email, '@', 1)),
    operation_value,
    need_value,
    coalesce(nullif(trim(registration->>'source'), ''), 'afcr-welcome-supabase'),
    new.id
  )
  returning id into new_organization_id;

  insert into public.profiles (user_id, organization_id, contact_name, role_title, phone)
  values (
    new.id,
    new_organization_id,
    coalesce(registration->>'contact_name', ''),
    coalesce(registration->>'role_title', ''),
    coalesce(registration->>'phone', '')
  );

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_afcr on auth.users;
create trigger on_auth_user_created_afcr
  after insert on auth.users
  for each row execute function private.handle_new_user();

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
    'organization_id', claimed.organization_id,
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

create or replace function public.poll_device_command(
  p_device_id text,
  p_device_api_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_device public.devices%rowtype;
  next_command public.device_commands%rowtype;
begin
  select * into requested_device
  from public.devices
  where device_id = p_device_id
    and device_api_key_hash = p_device_api_key_hash
    and claimed_at is not null;

  if requested_device.device_id is null then
    raise exception 'invalid device credential';
  end if;

  update public.devices
  set status = 'online', last_seen = now()
  where device_id = p_device_id;

  update public.device_commands
  set status = 'expired'
  where device_id = p_device_id
    and status in ('queued', 'delivered')
    and expires_at < now();

  select * into next_command
  from public.device_commands
  where device_id = p_device_id
    and status in ('queued', 'delivered')
  order by created_at asc
  limit 1
  for update;

  if next_command.command_id is null then
    return jsonb_build_object('command_id', null, 'target', 'led', 'action', 'none', 'status', 'idle');
  end if;

  if next_command.status = 'queued' then
    update public.device_commands
    set status = 'delivered', delivered_at = now()
    where command_id = next_command.command_id
    returning * into next_command;
  end if;

  return jsonb_build_object(
    'command_id', next_command.command_id,
    'target', next_command.target,
    'action', next_command.action,
    'espacio', next_command.espacio,
    'status', next_command.status,
    'expires_at', next_command.expires_at
  );
end;
$$;

create or replace function public.ack_device_command(
  p_command_id text,
  p_device_id text,
  p_device_api_key_hash text,
  p_status text,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  acknowledged public.device_commands%rowtype;
begin
  if p_status not in ('executed', 'failed') then
    raise exception 'unsupported ack status';
  end if;

  if not exists (
    select 1 from public.devices
    where device_id = p_device_id
      and device_api_key_hash = p_device_api_key_hash
      and claimed_at is not null
  ) then
    raise exception 'invalid device credential';
  end if;

  update public.device_commands
  set status = 'expired'
  where command_id = p_command_id
    and device_id = p_device_id
    and status in ('queued', 'delivered')
    and expires_at < now();

  update public.device_commands
  set status = p_status,
      ack_at = now(),
      failure_detail = nullif(trim(coalesce(p_detail, '')), '')
  where command_id = p_command_id
    and device_id = p_device_id
    and status in ('queued', 'delivered', 'executed', 'failed')
  returning * into acknowledged;

  if acknowledged.command_id is null then
    return null;
  end if;

  return to_jsonb(acknowledged) || jsonb_build_object(
    'transport', 'http_polling',
    'commands_url', '/device/commands'
  );
end;
$$;

create or replace function public.heartbeat_device(
  p_device_id text,
  p_device_api_key_hash text,
  p_status text default 'online'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.devices
  set status = case when p_status in ('online', 'offline', 'linked') then p_status else 'online' end,
      last_seen = now()
  where device_id = p_device_id
    and device_api_key_hash = p_device_api_key_hash
    and claimed_at is not null;
  return found;
end;
$$;

revoke all on function public.claim_device(text, text) from public;
revoke all on function public.poll_device_command(text, text) from public;
revoke all on function public.ack_device_command(text, text, text, text, text) from public;
revoke all on function public.heartbeat_device(text, text, text) from public;
grant execute on function public.claim_device(text, text) to anon, authenticated;
grant execute on function public.poll_device_command(text, text) to anon, authenticated;
grant execute on function public.ack_device_command(text, text, text, text, text) to anon, authenticated;
grant execute on function public.heartbeat_device(text, text, text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-audio',
  'voice-audio',
  false,
  10485760,
  array['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/flac']
)
on conflict (id) do nothing;

create policy "users upload own voice audio"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-audio'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "users read own voice audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-audio'
    and owner_id = (select auth.uid()::text)
  );

create policy "users delete own voice audio"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice-audio'
    and owner_id = (select auth.uid()::text)
  );

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-expired-voice-audio-daily',
  '15 3 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/purge-expired-voice-audio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'cron_anon_key')
    ),
    body := jsonb_build_object('source', 'daily-retention-job')
  );
  $cron$
);
