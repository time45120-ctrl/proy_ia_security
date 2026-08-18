# Guia de replicacion

Esta guia reconstruye Casa Domotica IA desde un clon limpio sin reutilizar
usuarios, datos ni credenciales de la instalacion original.

## 1. Requisitos y alcance

Requeridos:

- Git.
- Node.js 22 o posterior y npm.
- Python 3.12.
- Supabase alojado o Docker Desktop con integracion WSL/Linux.

Segun las funciones que se quieran probar:

- OpenAI API para transcripcion, interpretacion y TTS.
- Ollama y `backend/requirements-local-ai.txt` para IA/transcripcion local.
- Mosquitto para MQTT legacy.
- Arduino IDE, soporte ESP32 y cable USB para hardware real.
- VPS Hostinger con Nginx/Certbot para replicar el despliegue productivo.

Comprueba versiones:

```bash
node --version
npm --version
python3 --version
npx supabase --version
```

## 2. Clon e instalacion

```bash
git clone https://github.com/abraham-development/casa-domotica-ia.git
cd casa-domotica-ia
npm ci
npm --prefix frontend ci

python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install --upgrade pip
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

Para el modo local con Whisper:

```bash
backend/.venv/bin/python -m pip install -r backend/requirements-local-ai.txt
```

Ese paquete instala dependencias de audio y aprendizaje automatico de mayor
tamano. No es necesario cuando `AI_PROVIDER=openai`.

## 3. Supabase local

Supabase local necesita un runtime compatible con Docker. En Windows/WSL,
habilita la integracion de la distribucion desde Docker Desktop.

```bash
npm run supabase:start
npm run supabase:reset
npm run supabase:status
```

`db reset` aplica, en orden:

- todas las migraciones de `supabase/migrations/`;
- las tablas y funciones RPC;
- RLS y grants;
- el bucket privado `voice-audio`;
- `supabase/seed.sql`, que esta vacio para no copiar datos personales.

`supabase status` muestra valores locales. Transfiere los valores a los
archivos ignorados, sin confirmarlos en Git:

```text
frontend/.env.local
  NEXT_PUBLIC_SUPABASE_URL=<API URL local>
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key local>

backend/.env
  SUPABASE_URL=<API URL local>
  SUPABASE_PUBLISHABLE_KEY=<publishable key local>
  SUPABASE_SECRET_KEY=<secret key local>
```

No publiques la salida completa de `supabase status`: incluye credenciales de
administracion local. La UI de correo de prueba aparece normalmente en
`http://127.0.0.1:54324`; los correos locales no salen a Internet.

Para detener los contenedores:

```bash
npx supabase stop
```

## 4. Supabase alojado

### 4.1 Crear y migrar

1. Crea un proyecto nuevo en Supabase.
2. Guarda el project ref y password de base de datos en un gestor de secretos.
3. Enlaza el CLI y publica las migraciones:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

No uses datos exportados del proyecto original. Las migraciones son la fuente
del esquema; el seed intencionalmente no crea usuarios ni dispositivos.

### 4.2 Claves

Desde `Connect` o `Settings > API Keys` obtiene:

- Project URL.
- Publishable key para navegador y backend sin privilegios.
- Secret key solo para FastAPI.

No uses una secret key o `service_role` en el frontend. La publishable key es
visible por diseno; la autorizacion de filas depende de RLS.

### 4.3 Auth, redirects y correo

En `Authentication > URL Configuration` define:

```text
Site URL: https://YOUR_FRONTEND_DOMAIN
Redirect URLs:
  https://YOUR_FRONTEND_DOMAIN/auth/confirm
  https://www.YOUR_FRONTEND_DOMAIN/auth/confirm   # solo si se usa www
  http://localhost:3000/auth/confirm
  http://127.0.0.1:3000/auth/confirm
```

Mantiene confirmacion por email, OTP de 8 digitos y las plantillas versionadas
en `supabase/templates/`. Antes de ejecutar `npx supabase config push`, reemplaza
en `supabase/config.toml` los dominios de ejemplo/instalacion por los tuyos;
ese comando modifica la configuracion del proyecto enlazado.

Para correo productivo administra la cuenta/proveedor en Hostinger y configura
SMTP desde Supabase Dashboard:

- host y puerto del proveedor;
- usuario/remitente verificado;
- password SMTP;
- SPF, DKIM y DMARC del dominio.

El password SMTP se guarda en la configuracion de Supabase Auth, no en
`.env.example` ni en GitHub.

### 4.4 Retencion de audio

La migracion crea un cron diario y espera dos entradas de Vault:

- `project_url`: URL del proyecto.
- `cron_anon_key`: clave anon JWT legacy usada para invocar la funcion con la
  verificacion JWT actual.

La funcion se publica sin desactivar la verificacion JWT:

```bash
npx supabase functions deploy purge-expired-voice-audio
```

Configura Vault en el SQL Editor reemplazando los marcadores localmente:

```sql
select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co',
  'project_url'
);

select vault.create_secret(
  'YOUR_LEGACY_ANON_JWT',
  'cron_anon_key'
);
```

No guardes el SQL ya rellenado. La funcion recibe su credencial privilegiada
desde el entorno administrado de Supabase. Primero usa
`SUPABASE_SECRET_KEYS["default"]`, admite `SUPABASE_SECRET_KEY` en desarrollo
local y conserva `SUPABASE_SERVICE_ROLE_KEY` solo como fallback legacy. Ninguna
de estas claves se añade al repositorio.

La compatibilidad `cron_anon_key` es legacy. Las nuevas claves publishable no
son JWT y no deben enviarse como `Authorization: Bearer`. Antes de retirar las
legacy keys, migra el cron a un secreto de invocacion dedicado. No despliegues
esta funcion con `--no-verify-jwt` mientras no tenga su propia comprobacion de
autorizacion.

### 4.5 Validacion de Supabase

Despues de aplicar migraciones:

1. Comprueba que existen `households`, `household_members`, `profiles`,
   `devices`, `voice_intents`, `device_commands` y `device_led_states`.
2. Comprueba que todas tienen RLS habilitado.
3. Verifica que `voice-audio` sea privado.
4. Registra dos usuarios y confirma que cada uno solo ve su hogar.
5. Ejecuta Security Advisor y corrige cualquier hallazgo nuevo.

## 5. Variables del frontend

```bash
cp frontend/.env.example frontend/.env.local
```

Para desarrollo normal:

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=REPLACE_LOCALLY
```

Los nombres `NEXT_PUBLIC_*` significan que el valor termina en el bundle del
navegador. Solo URL, dominio, API publica y publishable key son apropiados.

## 6. Variables del backend

```bash
cp backend/.env.example backend/.env
chmod 600 backend/.env frontend/.env.local
```

Completa al menos:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=REPLACE_LOCALLY
PUBLIC_API_URL=http://localhost:8000
CORS_ALLOW_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=REPLACE_LOCALLY
SUPABASE_SECRET_KEY=REPLACE_LOCALLY
```

Los otros valores tienen defaults documentados en `backend/.env.example`.
`SUPABASE_SECRET_KEY`, OpenAI y MQTT password permanecen en el servidor.

Para Ollama:

```env
AI_PROVIDER=local
LOCAL_AI_MODEL=qwen2:7b-instruct-q4_0
```

```bash
ollama pull qwen2:7b-instruct-q4_0
```

## 7. Ejecucion y pruebas

Backend:

```bash
cd backend
.venv/bin/python -m uvicorn app_api:app --host 0.0.0.0 --port 8000
```

Frontend, desde la raiz:

```bash
npm run dev
```

Verificacion automatica:

```bash
npm run check:env
npm run frontend:build
npm run test:backend
curl http://localhost:8000/ping
```

`check:env` solo imprime nombres/estado; nunca imprime valores.

## 8. MQTT y ESP32

MQTT es opcional para dispositivos legacy. Para un broker local:

```env
MQTT_SERVER=127.0.0.1
MQTT_PORT=1883
MQTT_TLS=false
MQTT_USERNAME=
MQTT_PASSWORD=
```

En produccion usa autenticacion y TLS. El flujo moderno ESP32 no necesita MQTT:

1. La web crea un token temporal.
2. El usuario copia el sketch y completa WiFi/token localmente.
3. El ESP32 reclama una `device_api_key`, almacenada en el dispositivo.
4. Supabase guarda solo el hash.
5. El dispositivo hace polling y envia ACK.

Para hardware en LAN, `PUBLIC_API_URL` debe usar la IP LAN accesible desde el
ESP32. `localhost` apunta al propio ESP32 y nunca funciona para este caso.

## 9. Frontend en Hostinger

La configuracion actual usa `output: "export"` y genera `frontend/out/`. Las
variables publicas deben existir en Hostinger antes del build porque quedan
incorporadas en los archivos estaticos.

Conecta el monorepo, selecciona la rama `main` y usa `./frontend` como
directorio raiz. La configuracion recomendada es Node 24.x, comando
`npm run build`, directorio de salida `out` y ningun archivo de entrada.

Configura:

```text
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Build:

```bash
npm ci
npm run build
```

Publica `out/` y conserva el `.htaccess` generado por `postbuild`. Comprueba
raiz, `/welcome/`, assets de `/_next/` y `/auth/confirm/`.

## 10. Backend en Hostinger VPS

La replica productiva necesita:

- VPS Hostinger Ubuntu 24.04 con Python 3.12, Git, Nginx y Certbot.
- Firewall con 22/80/443; el puerto 8000 queda detras de Nginx.
- DNS `A api.YOUR_DOMAIN -> IP publica del VPS`.
- `backend/.env` creado directamente en el VPS con modo `600`.
- Servicio systemd que ejecute Uvicorn en `127.0.0.1:8000`.
- Nginx como reverse proxy y certificado TLS renovable.

El workflow `.github/workflows/deploy-backend-vps.yml` se activa cuando cambia
`backend/**` y actualiza el checkout del VPS por SSH. Configura en el
Environment `production`:

```text
VPS_HOST
VPS_USER
VPS_SSH_KEY
VPS_APP_DIR
BACKEND_APP_USER
BACKEND_APP_DIR
BACKEND_VENV_DIR
BACKEND_SERVICE_NAME
```

La clave privada solo debe existir como secreto de GitHub y la clave pública
debe estar autorizada en el VPS. El archivo `backend/.env` se crea manualmente
en el VPS y nunca se descarga desde el repositorio.

### 10.1 Supabase automatico desde GitHub

La integracion nativa Supabase-GitHub observa la rama `main`. Cuando se habilita
`Deploy to production`, aplica migraciones nuevas y publica las Edge Functions
declaradas en `supabase/config.toml`. El working directory es `.` porque
`supabase/` esta en la raiz. La funcion de purga debe conservar:

```toml
[functions.purge-expired-voice-audio]
verify_jwt = true
```

Configura una sola vez desde Supabase Dashboard:

```text
Project Settings > Integrations > GitHub
Repositorio: abraham-development/casa-domotica-ia
Working directory: .
Production branch: main
Deploy to production: habilitado
```

Autoriza la aplicacion de Supabase en GitHub cuando el navegador lo solicite.
Este flujo no necesita copiar `SUPABASE_ACCESS_TOKEN` ni
`SUPABASE_DB_PASSWORD` a GitHub Secrets. La integracion no despliega ajustes de
Auth, SMTP ni seed; esos cambios se administran expresamente en el Dashboard.

## 11. Checklist antes de publicar

```bash
git status --short
git diff --check
npm run check:env
npm run frontend:build
npm run test:backend
npm run preflight
```

Desde la maquina autorizada, despues de crear el commit y dejar el worktree
limpio, el preflight integrado tambien comprueba `gh`, el remoto y un push
simulado sin publicar cambios:

```bash
npm run deploy:check:all
```

Solo con autorizacion explicita, una recuperacion manual de Supabase conserva
este orden:

```bash
npx supabase db push --dry-run
npx supabase db push
npx supabase functions deploy --use-api
```

El repositorio permite `git push` directo a `main`; mantiene bloqueados
el borrado y el `force push`. Los Pull Requests son opcionales. El workflow
`.github/workflows/ci.yml` se ejecuta tanto en pushes a `main` como en Pull
Requests, por lo que despues de publicar se debe confirmar que los tres jobs
terminen correctamente.

Ademas:

- escanea el arbol y el historial con Gitleaks;
- confirma que `.env`, `.env.local`, grabaciones y SQLite no estan trackeados;
- revisa que no exista ningun `NEXT_PUBLIC_*SECRET*`;
- verifica CORS con origenes exactos;
- prueba registro, OTP, login, recuperacion y aislamiento RLS;
- rota cualquier secreto real que alguna vez haya entrado en un commit.

## 12. Archivos que nunca se copian entre instalaciones

- `frontend/.env.local`
- `backend/.env`
- `audios_recibidos/` y `backend/audios_recibidos/`
- `backend/devices.db*`
- `.pem`, `.ppk`, llaves privadas y certificados privados
- tokens de pairing, `device_api_key`, WiFi, SMTP y OpenAI
- exports de usuarios o datos de produccion

Cada persona crea sus propios proyectos, dominios y credenciales siguiendo los
`.env.example` y conserva los secretos fuera de Git.

## 13. Ubicacion de credenciales de produccion

| Credencial o valor | Ubicacion correcta |
|---|---|
| Variables `NEXT_PUBLIC_*` | Panel de Hostinger; son publicas y se incorporan al build |
| `OPENAI_API_KEY`, `SUPABASE_SECRET_KEY`, MQTT | `/opt/casa-domotica-ia/backend/.env` en el VPS, modo `600` |
| Acceso de despliegue al VPS | `VPS_SSH_KEY` como secreto de GitHub; la clave pública en el VPS |
| Host y rutas del VPS | Variables del Environment `production` de GitHub |
| Token de Supabase CLI | Perfil local administrado por el CLI, nunca dentro del repo |
| Password de Postgres/Supabase | Gestor de secretos; se introduce al enlazar o desplegar |
| Autorizacion Supabase-GitHub | Integracion OAuth administrada desde Supabase Dashboard; no copiar tokens ni passwords al repositorio |
| SMTP | Cuenta/proveedor administrado en Hostinger y credenciales configuradas en Supabase Auth; nunca GitHub |
| `project_url` y credencial del cron | Supabase Vault |
| WiFi y token de pairing | Copia local del sketch ESP32 |

El despliegue del VPS usa una clave SSH dedicada y restringida. Supabase no
requiere secretos manuales en GitHub cuando se usa la integracion nativa.
