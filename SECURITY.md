# Seguridad y manejo de secretos

## Regla principal

Los repositorios solo contienen codigo, migraciones, plantillas y valores de
ejemplo. Cada instalacion crea sus propias credenciales y las guarda en el
proveedor correspondiente o en archivos ignorados por Git.

## Clasificacion

Permitido en el frontend y visible en el navegador:

- URL publica del sitio y de la API.
- URL del proyecto Supabase.
- Supabase publishable key.

Exclusivo del backend o del proveedor:

- Supabase secret key o legacy `service_role`.
- OpenAI API key.
- Password SMTP.
- Password/token MQTT.
- AWS credentials, tokens de Supabase CLI y passwords de base de datos.
- Llaves privadas, certificados privados y credenciales de dispositivos.
- WiFi, tokens de pairing y `device_api_key` del ESP32.

Una variable `NEXT_PUBLIC_*` siempre debe considerarse publica. No confies en
la publishable key para autorizar datos: habilita RLS y aplica politicas por
usuario/hogar.

Para el despliegue automatizado, `SUPABASE_ACCESS_TOKEN` y
`SUPABASE_DB_PASSWORD` viven exclusivamente como secrets del Environment
`production` de GitHub. `SUPABASE_PROJECT_REF` y
`SUPABASE_DEPLOY_ENABLED` son variables no secretas. Mantener el interruptor
en `false` hasta confirmar que ambos secrets existen.

## Archivos locales

```text
frontend/.env.local
backend/.env
audios_recibidos/
backend/audios_recibidos/
backend/devices.db*
```

Estos archivos estan ignorados. En Linux/WSL protege los `.env` con:

```bash
chmod 600 frontend/.env.local backend/.env
```

No uses datos de produccion como seed, fixture o ejemplo. Las grabaciones de
voz son datos personales y no deben versionarse.

## Antes de un commit

```bash
npm run check:env
git diff --check
git status --short
```

Ejecuta tambien un detector como Gitleaks sobre el arbol y el historial. Revisa
manualmente cambios en `.github/`, firmware, scripts de despliegue y ejemplos.

## Si un secreto entra en Git

1. Revocalo o rotalo inmediatamente en el proveedor.
2. Actualiza solo los entornos autorizados.
3. Comprueba logs y uso no reconocido.
4. Eliminalo del estado actual.
5. Evalua una reescritura de historial coordinada; borrar una linea en el ultimo
   commit no elimina el valor de commits anteriores.
6. Invalida caches, artifacts y logs que pudieran contenerlo.

Una publishable key de Supabase no es secreta, pero no debe codificarse como
fallback de un proyecto concreto. Usa variables para que cada replica apunte a
su propio proyecto.

## Reporte privado

No abras un issue publico con el valor detectado. Comunica solamente el tipo de
credencial, archivo y commit por un canal privado con el responsable del
repositorio.
