-- Device tokens are sent to FastAPI. Only FastAPI may reach privileged RPCs.
revoke all on function public.claim_device(text, text) from anon, authenticated;
revoke all on function public.poll_device_command(text, text) from anon, authenticated;
revoke all on function public.ack_device_command(text, text, text, text, text) from anon, authenticated;
revoke all on function public.heartbeat_device(text, text, text) from anon, authenticated;

grant execute on function public.claim_device(text, text) to service_role;
grant execute on function public.poll_device_command(text, text) to service_role;
grant execute on function public.ack_device_command(text, text, text, text, text) to service_role;
grant execute on function public.heartbeat_device(text, text, text) to service_role;

create index device_commands_created_by_idx on public.device_commands (created_by);
create index device_commands_source_request_idx on public.device_commands (source_request_id);
create index voice_intents_user_idx on public.voice_intents (user_id);
create index devices_created_by_idx on public.devices (created_by);
create index profiles_organization_idx on public.profiles (organization_id);
create index organization_members_user_idx on public.organization_members (user_id);
