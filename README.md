# Casa Domotica IA

Asistente de voz para domotica residencial. El frontend captura audio, el
backend interpreta la intencion y prepara un plan que la persona debe confirmar
antes de enviar un comando a un ESP32. La aplicacion usa Supabase para Auth,
Postgres, RLS y Storage; OpenAI es el proveedor de IA predeterminado y MQTT se
conserva para dispositivos legacy.

Este monorepo es la unica fuente de verdad y contiene el frontend, el backend,
el firmware y la infraestructura reproducible. Los despliegues de Hostinger y
AWS parten de `main` y se limitan a su subdirectorio correspondiente.

## Arquitectura

```text
Navegador (Next.js)
  |-- Supabase Auth con clave publishable
  `-- HTTPS / REST con JWT de usuario
          |
          v
FastAPI
  |-- OpenAI u Ollama
  |-- Supabase Postgres + Storage privado
  |-- cola HTTP(S) para ESP32
  `-- MQTT legacy opcional
          |
          v
ESP32: polling autenticado -> GPIO -> ACK
```

El comando fisico nunca se ejecuta directamente al transcribir el audio. El
flujo es `preview -> confirmacion humana -> cola -> polling ESP32 -> ACK`.

## Requisitos

- Git.
- Node.js 22 o posterior y npm. `.nvmrc` fija la version base en Node 22.
- Python 3.12 y soporte para entornos virtuales.
- Una cuenta/proyecto de Supabase, o Docker Desktop para Supabase local.
- Una clave de OpenAI si se usa `AI_PROVIDER=openai`.
- Opcional: Ollama, Mosquitto, Arduino IDE y un ESP32.

Las librerias cliente de Supabase ya no soportan Node 20; utiliza Node 22 o una
version posterior compatible.

## Inicio rapido

### 1. Clonar e instalar

```bash
git clone https://github.com/abraham-development/casa-domotica-ia.git
cd casa-domotica-ia

npm ci
npm --prefix frontend ci

python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install --upgrade pip
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

En PowerShell, activa Python con:

```powershell
backend\.venv\Scripts\Activate.ps1
```

### 2. Preparar Supabase

Hay dos alternativas:

- Supabase alojado: crea un proyecto, enlaza el CLI y aplica las migraciones.
- Supabase local: instala Docker Desktop y ejecuta el stack incluido.

Supabase local:

```bash
npm run supabase:start
npm run supabase:reset
npm run supabase:status
```

El ultimo comando muestra la URL local y las claves generadas. Copialas solo a
los archivos locales indicados en el siguiente paso; no las pegues en codigo,
issues, commits ni documentacion.

Para un proyecto alojado:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy purge-expired-voice-audio
```

Las migraciones crean el esquema, las politicas RLS, RPC de dispositivos, el
bucket privado `voice-audio` y el trabajo de retencion. La funcion de purga y su
programacion requieren configuracion externa adicional, descrita en
[docs/REPLICACION.md](docs/REPLICACION.md).

### 3. Configurar variables

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
chmod 600 frontend/.env.local backend/.env
```

Completa los marcadores con valores de tu propio proyecto. La clasificacion es:

| Variable | Donde vive | Secreto |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Frontend | No, esta hecha para navegador |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend | No |
| `SUPABASE_SECRET_KEY` | Backend | Si |
| `OPENAI_API_KEY` | Backend | Si |
| `MQTT_PASSWORD` | Backend | Si, cuando se usa |
| Credenciales SMTP | Dashboard de Supabase | Si |
| SSID/password WiFi | Sketch local del ESP32 | Si |

Nunca declares una clave secret, `service_role`, OpenAI, SMTP o una contrasena
con el prefijo `NEXT_PUBLIC_`.

Comprueba la configuracion sin imprimir valores:

```bash
npm run check:env
```

### 4. Ejecutar

Terminal 1:

```bash
cd backend
.venv/bin/python -m uvicorn app_api:app --host 0.0.0.0 --port 8000
```

Terminal 2:

```bash
npm run dev
```

Abre `http://localhost:3000` y comprueba:

```bash
curl http://localhost:8000/ping
```

Para Supabase local, los correos de confirmacion no salen a Internet. Se ven en
el servidor de correo local mostrado por `npx supabase status`, normalmente en
`http://127.0.0.1:54324`.

## Verificacion

```bash
npm run check:env
npm run frontend:build
npm run test:backend
```

La prueba manual minima es:

1. Registrar y confirmar un usuario.
2. Iniciar sesion y abrir sincronizacion.
3. Crear un token de pairing para un ESP32.
4. Verificar que el sketch generado use la API configurada.
5. Grabar un comando de voz y revisar el preview.
6. Confirmar el plan y observar `queued`, `delivered` y `executed` tras el ACK.

## Supabase y seguridad de datos

- Todas las tablas expuestas tienen RLS.
- El aislamiento funcional se hace por hogar (`households`).
- La clave publishable no concede acceso privilegiado; RLS sigue siendo
  obligatoria.
- La clave secret/service role permanece solo en FastAPI.
- El bucket `voice-audio` es privado y los objetos tienen retencion.
- `supabase/seed.sql` esta vacio intencionalmente: una replica nunca debe copiar
  usuarios, hogares, dispositivos, grabaciones o comandos de produccion.

Consulta [SECURITY.md](SECURITY.md) antes de publicar un cambio y
[docs/REPLICACION.md](docs/REPLICACION.md) para la instalacion detallada.

## ESP32

El firmware base esta en:

```text
firmware/esp32_pairing_portal/esp32_pairing_portal.ino
```

El usuario solo completa en su copia local:

- `WIFI_SSID`
- `WIFI_PASSWORD`
- `PAIRING_TOKEN`

No confirmes esos valores en Git. Para pruebas en LAN, `PUBLIC_API_URL` debe ser
una URL accesible desde el ESP32, no `localhost`. En produccion debe ser HTTPS.

## Despliegue

- Frontend: aplicación Next.js/estatica en Hostinger conectada a este
  repositorio, rama `main`, directorio raiz `./frontend`, salida `out` y las
  cuatro variables `NEXT_PUBLIC_*` del ejemplo.
- Backend: FastAPI tras Nginx/HTTPS en una instancia AWS. `backend/.env` se crea
  directamente en la maquina y nunca se descarga del repositorio.
- GitHub Actions: `.github/workflows/deploy-backend.yml` filtra cambios de
  `backend/**`, usa OIDC + AWS SSM y no necesita access keys permanentes.
- CI: cada PR a `main` compila el frontend con Node 22, ejecuta las pruebas del
  backend con Python 3.12 y escanea el arbol publicable con Gitleaks.
- Supabase: las migraciones se publican con `supabase db push`; SMTP y redirects
  se configuran en el Dashboard con valores propios del despliegue.

Los detalles de DNS, CORS, Auth, SMTP, Vault, Edge Functions, AWS y Hostinger
estan en [docs/REPLICACION.md](docs/REPLICACION.md).

## Estructura

```text
backend/                         FastAPI, pruebas y despliegue AWS
frontend/                        Next.js, Auth y dashboard
firmware/esp32_pairing_portal/   Firmware Arduino/ESP32
supabase/migrations/             Esquema, RLS, Storage y RPC
supabase/functions/              Purga de audio
supabase/templates/              Plantillas de Auth
scripts/check-env.mjs            Verificacion sin mostrar valores
docs/REPLICACION.md              Guia completa
SECURITY.md                      Politica de secretos
```

## Repositorio canonico

- `abraham-development/casa-domotica-ia`

Los historiales de los antiguos repositorios de frontend y backend estan
conectados a este historial bajo `frontend/` y `backend/`. Los mapas entre SHA
originales y reescritos se conservan junto a los bundles privados de respaldo.

No se incluyen `.env`, bases SQLite, grabaciones, builds, tokens de pairing ni
credenciales WiFi en la fuente reproducible.
