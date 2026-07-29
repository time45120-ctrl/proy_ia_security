-- Allow the new canonical ESP32 multiroom bedroom name while keeping legacy compatibility.
-- Backend now emits `dormitorio`; older data and aliases may still contain `cuarto_principal`.

alter table public.devices
  drop constraint if exists devices_assigned_space_check;

alter table public.devices
  add constraint devices_assigned_space_check
  check (
    assigned_space is null
    or assigned_space in ('sala', 'comedor', 'cocina', 'dormitorio', 'cuarto_principal')
  );

alter table public.device_commands
  drop constraint if exists device_commands_espacio_check;

alter table public.device_commands
  add constraint device_commands_espacio_check
  check (espacio in ('sala', 'comedor', 'cocina', 'dormitorio', 'cuarto_principal'));
