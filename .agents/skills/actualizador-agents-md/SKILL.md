---
name: actualizador-agents-md
description: Usa esta skill cuando el usuario pida actualizar, sincronizar o refrescar los AGENTS.md del proyecto AFCR/proy_ia_security, incluyendo los archivos raiz, backend y frontend, con el estado real de commits, despliegues, voz, OpenAI, Supabase, ESP32 y reglas operativas.
---

# Actualizador de AGENTS.md

## Objetivo

Mantener sincronizados los tres archivos de memoria operativa del proyecto:

- `/home/abraham/proyectos/casa-domotica-ia/AGENTS.md`
- `/home/abraham/proyectos/casa-domotica-ia/backend/AGENTS.md`
- `/home/abraham/proyectos/casa-domotica-ia/frontend/AGENTS.md`

Usa esta skill cuando el usuario diga cosas como "actualiza mis AGENTS.md", "refresca la memoria del proyecto" o "sincroniza los AGENTS".

## Workflow Obligatorio

1. Lee primero los tres `AGENTS.md` completos o las secciones relevantes.
2. Ejecuta el inventario no destructivo:

   ```bash
   cd /home/abraham/proyectos/casa-domotica-ia
   python3 .agents/skills/actualizador-agents-md/scripts/inventory_agents_context.py
   ```

3. Revisa el estado y commits del unico monorepo desde la raiz; confirma
   que `backend/` y `frontend/` resuelvan al mismo toplevel Git.
4. Detecta la marca de frontend desde `frontend/scripts/print-deploy-info.js`.
5. Confirma constantes operativas desde codigo antes de documentarlas, por ejemplo:
   - `VOICE_AUDIO_MIN_BYTES`
   - `OPENAI_TRANSCRIBE_MODEL`
   - `OPENAI_TRANSCRIBE_FALLBACK_MODEL`
   - `SILENT_AUDIO_MIN_BYTES`
6. Actualiza solo hechos confirmados por el inventario, Git o codigo local.
7. Mantiene las reglas de seguridad existentes: no tocar `.env`, `.env.local`, claves, tokens, audios ni archivos generados.
8. Al terminar, ejecuta el script de inventario otra vez y revisa `git diff`.

## Reglas De Edicion

- No recrear la copia legacy anidada `proy_ia_security/`.
- Mantener un unico commit coherente desde la raiz del monorepo; no crear
  repos Git anidados en `backend/` ni `frontend/`.
- No cambiar codigo operativo cuando el usuario solo pidio actualizar memoria.
- Si hay cambios no relacionados en el worktree, no revertirlos; mencionarlos como preexistentes si afectan el diff.
- Mantener el texto conciso, factual y fechado.
- Actualizar los tres AGENTS en conjunto para evitar contradicciones.

## Contenido Que Normalmente Debe Sincronizarse

- Fecha de ultima revision.
- Ultimo commit operativo conocido de backend y frontend.
- Estado de despliegue Hostinger/AWS.
- Contratos activos de `/voice-intent`, confirmacion y ESP32 polling.
- Comportamiento actual de OpenAI/transcripcion/fallback.
- Reglas de diagnostico de microfono/audio.
- Flujo de pairing ESP32 y confirmacion de comandos.
- Comandos de build/test/deploy vigentes.
