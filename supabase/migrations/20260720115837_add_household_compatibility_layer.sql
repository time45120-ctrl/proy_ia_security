begin;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.households (id, created_by, created_at)
select id, created_by, created_at
from public.organizations
on conflict (id) do nothing;

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

insert into public.household_members (household_id, user_id, role, created_at)
select organization_id, user_id, role, created_at
from public.organization_members
on conflict (household_id, user_id) do nothing;

alter table public.profiles add column household_id uuid;
alter table public.devices add column household_id uuid;
alter table public.voice_intents add column household_id uuid;
alter table public.device_commands add column household_id uuid;
alter table public.device_led_states add column household_id uuid;

update public.profiles set household_id = organization_id;
update public.devices set household_id = organization_id;
update public.voice_intents set household_id = organization_id;
update public.device_commands set household_id = organization_id;
update public.device_led_states set household_id = organization_id;

alter table public.profiles
  add constraint profiles_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;
alter table public.devices
  add constraint devices_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;
alter table public.voice_intents
  add constraint voice_intents_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;
alter table public.device_commands
  add constraint device_commands_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;
alter table public.device_led_states
  add constraint device_led_states_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;

alter table public.profiles alter column household_id set not null;
alter table public.devices alter column household_id set not null;
alter table public.voice_intents alter column household_id set not null;
alter table public.device_commands alter column household_id set not null;
alter table public.device_led_states alter column household_id set not null;

create index profiles_household_idx on public.profiles (household_id);
create index household_members_user_idx on public.household_members (user_id);
create index devices_household_created_idx on public.devices (household_id, created_at desc);
create index devices_household_delivery_idx
  on public.devices (household_id, type, assigned_space, claimed_at desc);
create index voice_intents_household_created_idx
  on public.voice_intents (household_id, created_at desc);
create index device_commands_household_created_idx
  on public.device_commands (household_id, created_at desc);
create index device_led_states_household_device_idx
  on public.device_led_states (household_id, device_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create or replace function private.is_household_member(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members membership
    where membership.household_id = target_household
      and membership.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_household_member(uuid) from public, anon, authenticated;
grant execute on function private.is_household_member(uuid) to authenticated;

create policy "members view household"
  on public.households for select to authenticated
  using ((select private.is_household_member(id)));

create policy "members view household memberships"
  on public.household_members for select to authenticated
  using ((select private.is_household_member(household_id)));

create policy "household members view profiles"
  on public.profiles for select to authenticated
  using ((select private.is_household_member(household_id)));

create policy "users update own household profile"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (select private.is_household_member(household_id))
  );

create policy "household members view devices"
  on public.devices for select to authenticated
  using ((select private.is_household_member(household_id)));

create policy "household members create devices"
  on public.devices for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.is_household_member(household_id))
  );

create policy "household members update devices"
  on public.devices for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));

create policy "household members view voice intents"
  on public.voice_intents for select to authenticated
  using ((select private.is_household_member(household_id)));

create policy "users create household voice intents"
  on public.voice_intents for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.is_household_member(household_id))
  );

create policy "users update household voice intents"
  on public.voice_intents for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.is_household_member(household_id))
  )
  with check (
    user_id = (select auth.uid())
    and (select private.is_household_member(household_id))
  );

create policy "household members view device commands"
  on public.device_commands for select to authenticated
  using ((select private.is_household_member(household_id)));

create policy "users create household device commands"
  on public.device_commands for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.is_household_member(household_id))
  );

create policy "household members update device commands"
  on public.device_commands for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));

create policy "household members view device led states"
  on public.device_led_states for select to authenticated
  using ((select private.is_household_member(household_id)));

revoke all privileges on table public.households from anon, authenticated;
revoke all privileges on table public.household_members from anon, authenticated;
grant select on table public.households to authenticated;
grant select on table public.household_members to authenticated;
grant select, insert, update, delete on table public.households to service_role;
grant select, insert, update, delete on table public.household_members to service_role;
grant select (household_id) on table public.devices to authenticated;
grant select (household_id) on table public.voice_intents to authenticated;

create or replace function private.sync_household_scope_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.household_id is null then
    new.household_id := new.organization_id;
  elsif new.organization_id is null then
    new.organization_id := new.household_id;
  elsif new.household_id <> new.organization_id then
    raise exception 'household_id and legacy scope must match';
  end if;
  return new;
end;
$$;

revoke all on function private.sync_household_scope_columns() from public, anon, authenticated;

create trigger profiles_sync_household_scope
  before insert or update of organization_id, household_id on public.profiles
  for each row execute function private.sync_household_scope_columns();
create trigger devices_sync_household_scope
  before insert or update of organization_id, household_id on public.devices
  for each row execute function private.sync_household_scope_columns();
create trigger voice_intents_sync_household_scope
  before insert or update of organization_id, household_id on public.voice_intents
  for each row execute function private.sync_household_scope_columns();
create trigger device_commands_sync_household_scope
  before insert or update of organization_id, household_id on public.device_commands
  for each row execute function private.sync_household_scope_columns();
create trigger device_led_states_sync_household_scope
  before insert or update of organization_id, household_id on public.device_led_states
  for each row execute function private.sync_household_scope_columns();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household_id uuid := gen_random_uuid();
  registration jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_username text := lower(trim(coalesce(registration->>'username', '')));
begin
  if requested_username = '' then
    requested_username := 'u_' || substr(md5(new.id::text), 1, 28);
  end if;

  insert into public.organizations (id, name, source, created_by)
  values (
    new_household_id,
    coalesce(nullif(split_part(new.email, '@', 1), ''), 'hogar'),
    'afcr-household-transition',
    new.id
  );

  insert into public.households (id, created_by)
  values (new_household_id, new.id);

  insert into public.profiles (
    user_id, organization_id, household_id, username, phone
  ) values (
    new.id,
    new_household_id,
    new_household_id,
    requested_username,
    coalesce(registration->>'phone', '')
  );

  insert into public.organization_members (organization_id, user_id, role)
  values (new_household_id, new.id, 'owner');

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

commit;
