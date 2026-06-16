# jc-deploy

CLI interactiva para desplegar aplicaciones propias en una VPS Linux con Node.js, Nginx, PM2 y Certbot.

El paquete se llama `jc-deploy`, pero el comando global es:

```bash
deploy-app
```

## Instalacion local

```bash
npm install
npm link
```

Despues puedes ejecutar:

```bash
deploy-app
deploy-app front
deploy-app back
deploy-app fullstack
```

El prompt de repo acepta HTTPS y SSH:

```bash
https://github.com/owner/repo.git
https://github.com/owner/repo
git@github.com:owner/repo.git
git@github.com:owner/repo
```

Para revisar sin ejecutar cambios en la VPS:

```bash
deploy-app front --dry-run
```

## Modos

`deploy-app front` despliega un frontend estatico tipo React/Vite:

- clona o actualiza la repo
- instala dependencias
- crea `.env.production` desde `.env.example` si lo confirmas
- ejecuta build
- copia la carpeta compilada a `/var/www/<app>`
- genera Nginx con fallback SPA
- valida con `sudo nginx -t`
- recarga Nginx
- opcionalmente activa SSL con Certbot

`deploy-app back` despliega un backend Node.js:

- clona o actualiza la repo
- muestra puertos ocupados antes de pedir puerto
- instala dependencias
- crea `.env` desde `.env.example` si lo confirmas
- crea `ecosystem.config.js` si no existe
- inicia o reinicia PM2
- genera Nginx reverse proxy
- valida y recarga Nginx
- opcionalmente activa SSL
- muestra `pm2 status` y logs recientes

`deploy-app fullstack` despliega frontend y backend dentro de la misma repo:

- detecta subcarpetas comunes como `frontend`, `client`, `backend`, `api`
- lee `package.json` de cada subproyecto
- build del frontend hacia `/var/www/<app>/frontend`
- backend con PM2
- Nginx combinado con frontend SPA y reverse proxy para el API path

## Seguridad

La herramienta prioriza confirmacion y transparencia:

- pide confirmacion final antes de ejecutar cambios importantes
- no borra carpetas automaticamente
- si existe una config Nginx con el mismo nombre, crea backup en `/etc/nginx/sites-available/<app>.backup-YYYYMMDD-HHmmss`
- siempre ejecuta `sudo nginx -t` antes de recargar
- no imprime secretos de `.env`
- no activa SSL sin confirmacion
- detiene el proceso si falta `package.json`
- si falta PM2, pregunta si quieres instalarlo con `npm install pm2 -g`

## Dependencias usadas

- `commander`: definicion de comandos CLI
- `inquirer`: prompts interactivos
- `chalk`, `ora`, `boxen`: experiencia visual en terminal
- `execa`: ejecucion segura sin interpolacion shell
- `fs-extra`: operaciones de filesystem comodas y robustas

No se incluye `dotenv` porque la CLI no necesita cargar variables secretas; solo copia archivos `.env.example` cuando el usuario lo confirma.
# jc-deploy
