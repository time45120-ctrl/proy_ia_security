# Endurecer Autenticación Contra Bots

## Summary
Añadir protección anti-bots al flujo público de login/registro sin romper Supabase Auth ni el acceso normal al laboratorio. La opción recomendada es Cloudflare Turnstile por menor fricción para usuarios reales.

## Key Changes
- Frontend:
  - Añadir Turnstile al modal de login y registro.
  - Guardar el token temporal del challenge en estado local.
  - Enviar `options: { captchaToken }` en `signUp()` y `signInWithPassword()`.
  - Resetear el challenge después de error o envío.
  - Mostrar error neutral si falta o falla CAPTCHA.
- Supabase:
  - Activar CAPTCHA protection en Auth con Cloudflare Turnstile.
  - Configurar secret key en Supabase Dashboard, no en el frontend.
  - Revisar Auth Rate Limits en Supabase Dashboard.
- UX/Seguridad:
  - Mantener mensajes de login más genéricos para no ayudar a enumerar emails.
  - No tocar RLS, triggers, backend, `.env.local`, despliegue ni firmware.
  - Mantener `/desarrollo` protegido por middleware.

## Test Plan
- Registro:
  - Sin Turnstile resuelto debe bloquear.
  - Con Turnstile resuelto debe enviar correo o crear sesión según configuración.
- Login:
  - Sin Turnstile resuelto debe bloquear.
  - Con credenciales válidas entra normalmente.
  - Con credenciales inválidas muestra mensaje neutral.
- Regresión:
  - `/welcome` carga.
  - `/desarrollo/sync` sin sesión redirige.
  - `/desarrollo/dashboard` sin sesión redirige.
  - Con sesión, dashboard y sync funcionan.
- Seguridad:
  - Confirmar en Supabase que CAPTCHA protection queda activo.
  - Confirmar que no se expone secret key en `NEXT_PUBLIC_*`.

## Assumptions
- Usar Cloudflare Turnstile como proveedor recomendado.
- La Site Key sí puede ir en frontend; la Secret Key solo en Supabase Dashboard.
- Esta mejora complementa, pero no reemplaza, la actualización de Next.js pendiente.
