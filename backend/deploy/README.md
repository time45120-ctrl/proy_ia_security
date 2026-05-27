# Despliegue AWS del Backend

El despliegue automatico se ejecuta desde `proy_ia_backend/main` mediante
GitHub Actions y AWS Systems Manager (SSM). La llave `.ppk` no participa en el
workflow: se usa solo para preparar inicialmente la instancia si SSM todavia
no esta disponible.

## Preparacion De EC2

Antes del primer despliegue automatico:

1. Confirmar la ruta real, el proxy HTTPS y el proceso actual de FastAPI.
2. Instalar o habilitar SSM Agent y asociar un Instance Profile con
   `AmazonSSMManagedInstanceCore`.
3. Usar el checkout identificado en `/home/ubuntu/proy_ia_backend` con remoto
   `time45120-ctrl/proy_ia_backend`, rama `main`.
4. Usar el entorno virtual existente en `/home/ubuntu/proy_ia_backend/.venv`.
5. Crear o completar `/home/ubuntu/proy_ia_backend/.env` con permisos
   restringidos y las variables
   privadas, incluida `SUPABASE_SECRET_KEY`.
6. Mantener el servicio existente `proy-ia-backend.service` y el proxy Nginx
   existente hacia `http://127.0.0.1:8000`.

No guardar `.ppk`, `.env` ni Secret keys en GitHub.

## Primer Despliegue Manual Por SSH

Mientras SSM y GitHub Actions no esten configurados, el despliegue inicial
puede hacerse manualmente entrando con la `.ppk` desde el equipo del usuario:

```bash
cd /home/ubuntu/proy_ia_backend
git status --short --branch
git pull --ff-only origin main
.venv/bin/python -m pip install --requirement requirements.txt
.venv/bin/python -c "import ast, pathlib; ast.parse(pathlib.Path('app_api.py').read_text()); print('app_api.py syntax OK')"
.venv/bin/python -B -m unittest -v test_http_polling.py
sudo systemctl restart proy-ia-backend.service
sudo systemctl --no-pager --full status proy-ia-backend.service
curl --fail --silent --show-error http://127.0.0.1:8000/ping
curl --fail --silent --show-error https://api.afcrseguridad.com/ping
```

No ejecutar `git pull` si `git status` muestra cambios locales en EC2; primero
hay que revisarlos para no sobrescribir configuracion o codigo activo.

## Configuracion GitHub Actions

Crear un Environment de GitHub llamado `production` con estas variables:

| Variable | Valor esperado |
| --- | --- |
| `AWS_REGION` | Region donde existe la instancia EC2 |
| `AWS_ROLE_TO_ASSUME` | ARN del rol IAM asumible por GitHub OIDC |
| `AWS_INSTANCE_ID` | Identificador de la instancia EC2 backend |
| `BACKEND_APP_USER` | Opcional, default `ubuntu` |
| `BACKEND_APP_DIR` | Opcional, default `/home/ubuntu/proy_ia_backend` |
| `BACKEND_VENV_DIR` | Opcional, default `/home/ubuntu/proy_ia_backend/.venv` |
| `BACKEND_SERVICE_NAME` | Opcional, default `proy-ia-backend.service` |
| `BACKEND_LOCAL_HEALTH_URL` | Opcional, default `http://127.0.0.1:8000/ping` |
| `PUBLIC_HEALTH_URL` | Opcional, default `https://api.afcrseguridad.com/ping` |

Como el workflow utiliza el Environment `production`, configurar sus reglas
de deployment para permitir solamente la rama `main` y, si se desea revision
humana antes del despliegue, requerir aprobacion.

El rol OIDC debe confiar unicamente en el sujeto del Environment:

```text
repo:time45120-ctrl/proy_ia_backend:environment:production
```

Y debe tener permisos minimos para `ssm:SendCommand` sobre la instancia y el
documento `AWS-RunShellScript`, junto con `ssm:GetCommandInvocation` para leer
el resultado.

## Secuencia Del Workflow

Al hacer `push` autorizado a `main`, el workflow:

1. Obtiene credenciales temporales AWS mediante OIDC.
2. Ejecuta por SSM un avance fast-forward del checkout de EC2 como usuario
   `ubuntu`, para preservar propietarios y permisos.
3. Ejecuta `scripts/deploy-ec2.sh`, que instala dependencias, valida el
   backend, corre las pruebas de polling, reinicia el servicio y consulta el
   health check local.
4. Consulta `https://api.afcrseguridad.com/ping` desde GitHub Actions.
