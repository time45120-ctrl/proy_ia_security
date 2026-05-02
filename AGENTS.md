# AGENTS.md - Memoria compacta de Codex

## Contexto rapido

Este proyecto es un asistente de voz IoT para laboratorio local. El flujo actual
captura audio desde el dashboard, lo envia a un backend FastAPI, transcribe con
Whisper, interpreta la intencion con OpenAI u Ollama y publica comandos MQTT
para luces por ambiente.

La fuente activa del proyecto es esta raiz:

```text
/home/abraham/proy_ia_security
```

La carpeta anidada `proy_ia_security/` es una copia legacy. No usarla como
referencia principal ni editarla salvo que el usuario lo pida de forma explicita.

## Mapa del proyecto

- Backend principal: `backend/app_api.py`
- Frontend principal: `frontend/`
- Audios recibidos: `audios_recibidos/`
- README principal: `README.md`
- Env de ejemplo frontend: `frontend/.env.example`

Stack actual:

- Frontend: Next.js, React, TypeScript y Tailwind.
- Backend: FastAPI, Whisper, OpenAI u Ollama, MQTT con `paho-mqtt`.
- Broker MQTT esperado por el backend: `127.0.0.1:1883`.

## Contratos activos

Endpoint de salud:

```text
GET /ping
```

Endpoint principal:

```text
POST /voice-intent
multipart/form-data audio=<archivo>
```

Topic MQTT activo:

```text
casa/esp32/luces
```

Payload MQTT activo:

```json
{
  "espacio": "cocina",
  "accion": "ON"
}
```

Ambientes validos:

- `sala`
- `comedor`
- `cocina`
- `cuarto_principal`

Acciones validas:

- `ON`
- `OFF`

## Comandos utiles

Levantar backend:

```bash
cd /home/abraham/proy_ia_security/backend
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

Levantar frontend:

```bash
cd /home/abraham/proy_ia_security/frontend
npm run dev
```

Build frontend:

```bash
cd /home/abraham/proy_ia_security/frontend
npm run build
```

Health check:

```bash
curl http://localhost:8000/ping
```

Verificar sintaxis del backend:

```bash
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('backend/app_api.py').read_text()); print('backend/app_api.py syntax OK')"
```

## Alternar proveedor de IA

El backend carga variables locales desde `backend/.env`, ignorado por git.
Usar `backend/.env.example` como plantilla. `frontend/.env.local` es solo para
variables del frontend como `NEXT_PUBLIC_API_BASE_URL`; nunca guardar secretos
en variables `NEXT_PUBLIC_*` porque llegan al navegador.

La Fase 3 cambia entre OpenAI API e IA local con esta linea de
`backend/app_api.py`:

```python
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai").strip().lower()
```

Para usar OpenAI API:

```bash
cd /home/abraham/proy_ia_security/backend
cp .env.example .env
# Editar backend/.env:
#
# AI_PROVIDER=openai
# OPENAI_API_KEY=TU_API_KEY
# OPENAI_MODEL=gpt-4o-mini
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

Para volver a IA local con Qwen2/Ollama:

```bash
cd /home/abraham/proy_ia_security/backend
# Editar backend/.env:
#
# AI_PROVIDER=local
# LOCAL_AI_MODEL=qwen2:7b-instruct-q4_0
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

No guardar claves reales en archivos del repo.

## Reglas para futuras sesiones

- No tocar `.env.local`, claves, tokens ni secretos.
- No editar `proy_ia_security/` anidado salvo peticion explicita.
- Respetar cambios existentes del usuario en el worktree.
- Preferir cambios pequenos, locales y verificados.
- Usar `README.md` como fuente extendida de arquitectura, comandos y
  troubleshooting.
- Mantener el contrato MQTT actual salvo que el usuario pida cambiarlo:
  topic `casa/esp32/luces` y payload `{ "espacio": "...", "accion": "ON|OFF" }`.
- Antes de cambiar frontend, revisar `frontend/lib/backend-api.ts` y
  `frontend/components/voice-dashboard.tsx`.
- Antes de cambiar backend, revisar `backend/app_api.py` completo.

## Notas operativas

- `frontend/.env.local` sobreescribe `NEXT_PUBLIC_API_BASE_URL`.
- El frontend puede apuntar a una IP LAN de Windows si FastAPI corre dentro de
  WSL y se expone con `portproxy`.
- Si despues de reiniciar Windows o WSL deja de conectar, sospechar primero de la
  IP interna de WSL y de las reglas `portproxy` para `8000` y `1883`.
- El cambio de este archivo es documentacion; no requiere build ni tests de app.
