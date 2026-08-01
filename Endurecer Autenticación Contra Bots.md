# Endurecer Autenticación Contra Bots

Estado al 2026-08-01: propuesta pendiente, no forma parte del despliegue `f.65`.
No activarla en Supabase hasta que el frontend incluya el widget y existan las
dos credenciales de Turnstile.

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
  - Mantener `/desarrollo` protegido por la validacion de sesion del cliente y
    por la autorizacion JWT/RLS obligatoria del backend.

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
- Cuando se implemente, la Site Key se configurara en Hostinger como
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; la Secret Key vivira solamente en Supabase
  Auth > CAPTCHA protection.
- Esta mejora es independiente de Next.js, actualmente fijado en `15.5.22`.
