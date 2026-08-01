# Actualización Segura De Next.js Sin Romper La Web

## Summary
Corregir las vulnerabilidades del frontend actualizando únicamente Next.js dentro de la rama compatible 15.x, manteniendo React, Supabase, Hostinger y la estructura actual sin cambios funcionales.

## Key Changes
- Dependencias:
  - Actualizar solo `next` desde `15.5.15` a una versión parchada 15.x, mínimo `15.5.18`.
  - Regenerar `package-lock.json` con `npm install`, sin `--force`.
  - No tocar React, Tailwind, Supabase, `.env.local`, `server.js`, `next.config.js` ni Hostinger.
- Compatibilidad:
  - Mantener `npm run build` y `npm run start` igual.
  - Mantener `middleware.ts` protegiendo `/desarrollo/:path*`.
  - Mantener `AFCR_FRONTEND_MODE=next-server`.
- Validación:
  - Revisar `npm audit --production` después de actualizar.
  - Ejecutar `npm run build`.
  - Si el build falla, no forzar cambios grandes; revisar el error y retroceder solo el cambio de Next si es necesario.

## Test Plan
- Antes:
  - Confirmar que no hay `next dev` activo para evitar corrupción de `.next`.
  - Revisar `git status` del frontend.
- Después:
  - `npm audit --production`
  - `npm run build`
  - `PORT=3101 npm run start`
  - Probar:
    - `/welcome` carga.
    - `/desarrollo/sync` sin sesión redirige a `/welcome`.
    - `/desarrollo/dashboard` sin sesión redirige a `/welcome`.
    - Con sesión, dashboard y sync cargan normalmente.
    - La tarjeta de voz sigue mostrando respuesta IA y JSON.
- No hacer commit, push ni despliegue salvo autorización explícita.

## Assumptions
- El cambio se limita a `/home/abraham/proyectos/casa-domotica-ia/frontend`.
- Se prioriza seguridad sin romper producción.
- Si aparece incompatibilidad, se detiene y se reporta antes de ampliar cambios.
