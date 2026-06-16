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
deploy-app status
deploy-app update
deploy-app repair
deploy-app logs
deploy-app doctor
deploy-app preflight
deploy-app import
```

Al ejecutar solo `deploy-app`, el menu principal permite elegir entre nuevo despliegue, actualizar, reparar, ver estado, logs, importar una app existente, doctor o salir.

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

## Operaciones sobre apps existentes

`jc-deploy` crea o actualiza un archivo `.jc-deploy.json` dentro de cada proyecto desplegado. Ese archivo permite repetir operaciones sin volver a introducir todos los datos.

Tambien mantiene un indice global en `~/.jc-deploy/apps.json`. La metadata JSON local es la fuente principal por ahora; MongoDB o un dashboard pueden sincronizarse mas adelante, pero no son necesarios para usar la CLI.

Reglas de metadata:

- cada app tiene `/home/<usuario>/apps/<appName>/.jc-deploy.json`
- el indice global no duplica apps por nombre/ruta
- nunca se guardan valores reales de `.env`
- solo se guarda si `.env` existe, si esta completo y nombres de claves faltantes
- si un despliegue falla, se guarda `status: "partial"`, `lastStep` y `lastError`

Comandos disponibles:

```bash
deploy-app status cv_proexpress
deploy-app update cv_proexpress
deploy-app repair cv_proexpress
deploy-app logs cv_proexpress
deploy-app doctor
deploy-app preflight cv_proexpress
deploy-app import
```

Si no pasas nombre de app, la CLI lista apps detectadas en `/home/<usuario>/apps`.

`deploy-app status` inspecciona:

- repo Git, remote, rama y cambios locales
- `package.json`, `"type": "module"` y scripts relevantes
- `node_modules`, `dist`, `.env`, `.env.example`
- `ecosystem.config.cjs` y `ecosystem.config.js`
- proceso PM2
- config y symlink Nginx
- `sudo nginx -t`
- certificado Certbot cuando puede detectarse

`deploy-app update` hace `git pull` de forma segura. Si hay cambios locales, pide confirmacion antes de continuar. Luego puede ejecutar instalacion, build, reinicio PM2, copia de build frontend y reload de Nginx segun el tipo de app y la configuracion guardada.

`deploy-app repair` permite regenerar `ecosystem.config.cjs`, renombrar `ecosystem.config.js` a `.cjs` en proyectos `"type": "module"`, reparar Nginx, activar symlink, validar Nginx y reiniciar PM2.

En apps backend, `repair` y `update` validan antes de PM2 si falta `dist` y el `start` depende de salida compilada como `dist/server.cjs`, `server.cjs` o `build/`. Si hay script `build`, preguntan si ejecutar `npm run build` con default `si`; si el build parece obligatorio y se rechaza, PM2 no se inicia para evitar dejar la app en `errored`.

Si `repair` detecta que Nginx existe, la app responde por HTTP y `sslEnabled` esta en `false`, pregunta si quieres activar SSL con Certbot. Antes valida DNS contra la IP publica de la VPS, `sudo nginx -t`, acceso por puerto 80 y que no exista ya un certificado para ese dominio. Si Certbot termina correctamente, actualiza `.jc-deploy.json` con `sslEnabled: true` y `status: "online"`.

`deploy-app logs` muestra `pm2 status` y los ultimos logs de la app.

`deploy-app import` registra apps existentes que no fueron creadas originalmente por jc-deploy. Busca candidatos en `/home/<usuario>/apps`, metadata existente, repos Git, `package.json`, procesos PM2 y configuraciones Nginx. `/var/www` se usa solo como pista secundaria porque normalmente contiene builds estaticos, no codigo fuente.

`deploy-app doctor` revisa el entorno general de la VPS:

- binarios: `git`, `node`, `npm`, `pm2`, `nginx`, `systemctl`, `certbot`, `ssh`, `sudo`, `rsync`
- usuario actual con `whoami` e `id`
- versiones de Node y npm
- `pm2 status` sin sudo
- `sudo nginx -t`
- advierte si se ejecuta como root
- si falta PM2, pregunta si instalarlo con `npm install pm2 -g`
- si falta Certbot, muestra el comando recomendado para Debian/Ubuntu

`deploy-app preflight [appName]` revisa una app concreta:

- estado real de Git, package, PM2, Nginx, SSL y `.env`
- `.nvmrc` si existe
- variables vacias en `.env` sin imprimir secretos
- binarios faltantes para `yarn` o `pnpm`
- puertos hardcodeados en archivos comunes y recomienda `process.env.PORT`

Antes de clonar, jc-deploy ejecuta `git ls-remote <repoUrl>` con timeout. Para URLs SSH tambien verifica GitHub en `known_hosts` y prueba acceso SSH.

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
- si existe `scripts.build`, pregunta si debe ejecutar build antes de PM2, con default `si`
- si el start apunta a `dist/`, `build/`, `server.cjs` o `server.js`, avisa que el build parece obligatorio
- en `repair` y `update`, si falta `dist` y el start depende de `dist/server.cjs`, ejecuta build antes de PM2 o detiene PM2 si el usuario rechaza
- crea `.env` desde `.env.example` si lo confirmas
- crea `ecosystem.config.cjs` si no existe, compatible con proyectos `"type": "module"`
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
- si `git status --porcelain` muestra cambios locales, pide confirmacion antes de `git pull`
- si PM2 ya tiene un proceso con el mismo nombre, pregunta antes de reiniciarlo
- evita spinners infinitos en `git clone` con timeout de 60 segundos
- valida acceso al repo con `git ls-remote` antes de clonar
- usa `sudo -v` y mantiene viva la sesion sudo solo durante operaciones privilegiadas

## Rutas

- `/home/<usuario>/apps/<appName>`: codigo fuente real y metadata `.jc-deploy.json`
- `/var/www/<appName>`: archivos publicos compilados para frontends
- `/etc/nginx/sites-available` y `/etc/nginx/sites-enabled`: configuraciones Nginx
- `~/.jc-deploy/apps.json`: indice global de apps gestionadas

## Tests

```bash
npm run lint
npm test
node src/index.js doctor
node src/index.js --help
```

## Dependencias usadas

- `commander`: definicion de comandos CLI
- `inquirer`: prompts interactivos
- `chalk`, `ora`, `boxen`: experiencia visual en terminal
- `execa`: ejecucion segura sin interpolacion shell
- `fs-extra`: operaciones de filesystem comodas y robustas

No se incluye `dotenv` porque la CLI no necesita cargar variables secretas; solo copia archivos `.env.example` cuando el usuario lo confirma.
