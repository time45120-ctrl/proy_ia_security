# Despliegue AWS del Backend desde el monorepo

El despliegue automatico se ejecuta desde `casa-domotica-ia/main` mediante el
workflow raiz `.github/workflows/deploy-backend.yml`, GitHub OIDC y AWS Systems
Manager (SSM). La llave `.ppk` no participa en el workflow.

## Preparacion De EC2

Antes del primer despliegue automatico:

1. Confirmar la ruta real, el proxy HTTPS y el proceso actual de FastAPI.
2. Instalar o habilitar SSM Agent y asociar un Instance Profile con
   `AmazonSSMManagedInstanceCore`.
3. Conservar el checkout anterior `/home/ubuntu/proy_ia_backend` y su `.venv`
   como rollback; el bootstrap no los elimina ni los actualiza.
4. Crear el checkout paralelo `/home/ubuntu/casa-domotica-ia` mediante el modo
   `bootstrap` del workflow.
5. El bootstrap copia el `.env` anterior a
   `/home/ubuntu/casa-domotica-ia/backend/.env` con modo `600`; nunca imprime
   ni sube sus valores.
6. Mantener el servicio existente `proy-ia-backend.service` y el proxy Nginx
   existente hacia `http://127.0.0.1:8000`.

No guardar `.ppk`, `.env` ni Secret keys en GitHub.

## Bootstrap y rollback

El primer corte se ejecuta con `workflow_dispatch`, opcion `bootstrap`. El
script `backend/scripts/bootstrap-monorepo-ec2.sh` es idempotente: clona o
actualiza el monorepo, verifica que el commit disparador este presente, instala
dependencias, ejecuta sintaxis y pruebas, crea el drop-in
`/etc/systemd/system/proy-ia-backend.service.d/20-monorepo.conf` y valida
`/ping`.

Si la nueva aplicacion no inicia o falla el health check, el script retira el
drop-in nuevo, restaura el anterior si existia y reinicia el servicio con su
configuracion previa. Los artefactos de systemd quedan en
`/var/backups/casa-domotica-ia`.

## Configuracion GitHub Actions

Crear un Environment de GitHub llamado `production` con estas variables:

| Variable | Valor esperado |
| --- | --- |
| `AWS_REGION` | Region donde existe la instancia EC2 |
| `AWS_ROLE_TO_ASSUME` | ARN del rol IAM asumible por GitHub OIDC |
| `AWS_INSTANCE_ID` | Identificador de la instancia EC2 backend |
| `MONOREPO_DIR` | `/home/ubuntu/casa-domotica-ia` |
| `BACKEND_APP_USER` | Opcional, default `ubuntu` |
| `BACKEND_APP_DIR` | `/home/ubuntu/casa-domotica-ia/backend` |
| `BACKEND_VENV_DIR` | `/home/ubuntu/casa-domotica-ia/backend/.venv` |
| `LEGACY_BACKEND_APP_DIR` | `/home/ubuntu/proy_ia_backend` |
| `BACKEND_SERVICE_NAME` | Opcional, default `proy-ia-backend.service` |
| `BACKEND_LOCAL_HEALTH_URL` | Opcional, default `http://127.0.0.1:8000/ping` |
| `PUBLIC_HEALTH_URL` | Opcional, default `https://api.afcrtecnologia.com/ping` |
| `MONOREPO_BACKEND_DEPLOY_ENABLED` | `false` durante el bootstrap; `true` tras validarlo |

Como el workflow utiliza el Environment `production`, configurar sus reglas
de deployment para permitir solamente la rama `main` y, si se desea revision
humana antes del despliegue, requerir aprobacion.

El rol OIDC debe confiar unicamente en el sujeto del Environment:

```text
repo:abraham-development@260437753/casa-domotica-ia@1195824020:environment:production
```

GitHub usa este formato inmutable porque el repositorio fue renombrado despues
del 15 de julio de 2026. Los IDs de propietario y repositorio forman parte del
`sub` y deben coincidir exactamente con la trust policy de AWS. Para otra
instalacion, consulta el `sub_claim_prefix` mediante la API OIDC de GitHub en
lugar de copiar estos numeros.

Y debe tener permisos minimos para `ssm:SendCommand` sobre la instancia y el
documento `AWS-RunShellScript`, junto con `ssm:GetCommandInvocation` para leer
el resultado.

## Secuencia Del Workflow

El workflow sigue esta secuencia:

1. Obtiene credenciales temporales AWS mediante OIDC.
2. En modo `bootstrap`, instala el checkout paralelo y el drop-in recuperable.
3. En despliegues normales, avanza `main` con `--ff-only` como usuario
   `ubuntu` y ejecuta `backend/scripts/deploy-ec2.sh`.
4. Ejecuta las 26 pruebas, reinicia el servicio y consulta el health local.
5. Consulta `https://api.afcrtecnologia.com/ping` desde GitHub Actions.

Los pushes quedan ignorados mientras
`MONOREPO_BACKEND_DEPLOY_ENABLED=false`. El modo manual `bootstrap` es la unica
excepcion deliberada a esa guardia.
