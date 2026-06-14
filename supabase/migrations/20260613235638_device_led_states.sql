create table if not exists public.device_led_states (
  device_id text not null references public.devices(device_id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  espacio text not null check (espacio in ('sala', 'comedor', 'cocina', 'dormitorio')),
  status text not null default 'OFF' check (status in ('ON', 'OFF')),
  updated_at timestamptz not null default now(),
  source_command_id text references public.device_commands(command_id) on delete set null,
  primary key (device_id, espacio)
);

create index if not exists device_led_states_org_device_idx
  on public.device_led_states (organization_id, device_id);

alter table public.device_led_states enable row level security;

drop policy if exists "members view device led states" on public.device_led_states;

create policy "members view device led states"
  on public.device_led_states for select to authenticated
  using ((select private.is_organization_member(organization_id)));

revoke all privileges on table public.device_led_states from anon, authenticated;
grant select on table public.device_led_states to authenticated;
grant select, insert, update, delete on table public.device_led_states to service_role;
