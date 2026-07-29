alter table public.profiles
  add column if not exists username text;

update public.profiles
set username = 'u_' || substr(md5(user_id::text), 1, 28)
where username is null
  or trim(username) = '';

alter table public.profiles
  alter column username set not null;

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[a-z0-9_]{3,30}$');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_username_unique'
  ) then
    alter table public.profiles
      add constraint profiles_username_unique unique (username);
  end if;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  registration jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_username text := lower(trim(coalesce(registration->>'username', '')));
begin
  if requested_username = '' then
    requested_username := 'u_' || substr(md5(new.id::text), 1, 28);
  end if;

  insert into public.organizations (name, source, created_by)
  values (
    coalesce(nullif(trim(registration->>'company_name'), ''), split_part(new.email, '@', 1)),
    coalesce(nullif(trim(registration->>'source'), ''), 'afcr-welcome-supabase'),
    new.id
  )
  returning id into new_organization_id;

  insert into public.profiles (user_id, organization_id, username, phone)
  values (
    new.id,
    new_organization_id,
    requested_username,
    coalesce(registration->>'phone', '')
  );

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
