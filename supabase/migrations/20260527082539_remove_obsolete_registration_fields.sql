-- New registrations collect only organization name and contact phone.
-- Authorization membership roles remain separate from the removed job title.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  registration jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.organizations (name, source, created_by)
  values (
    coalesce(nullif(trim(registration->>'company_name'), ''), split_part(new.email, '@', 1)),
    coalesce(nullif(trim(registration->>'source'), ''), 'afcr-welcome-supabase'),
    new.id
  )
  returning id into new_organization_id;

  insert into public.profiles (user_id, organization_id, phone)
  values (
    new.id,
    new_organization_id,
    coalesce(registration->>'phone', '')
  );

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

alter table public.organizations
  drop column if exists operation_size,
  drop column if exists primary_need;

alter table public.profiles
  drop column if exists contact_name,
  drop column if exists role_title;

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
  - 'contact_name'
  - 'role_title'
  - 'operation_size'
  - 'primary_need'
where coalesce(raw_user_meta_data, '{}'::jsonb)
  ?| array['contact_name', 'role_title', 'operation_size', 'primary_need'];
