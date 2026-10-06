# Operación del CRM

Guía de lo que hay que configurar una vez para operar el CRM en
producción: monitorización, alertas, copias de seguridad,
actualizaciones del proyecto original e integraciones. El despliegue en
sí está en [vercel.md](vercel.md).

## Checklist de puesta en marcha

- [ ] Variables de entorno en Vercel (ver [vercel.md](vercel.md))
- [ ] Sentry: `SENTRY_DSN` y `NEXT_PUBLIC_SENTRY_DSN`
- [ ] Alertas: `HEALTH_ALERT_WEBHOOK_URL`
- [ ] Zona horaria: `AUTOMATION_TIMEZONE=America/Bogota`
- [ ] GitHub → Settings → Actions: Actions habilitadas
- [ ] GitHub → Settings → General → Features: **Issues** habilitado
      (en repos que vienen de un fork viene desactivado)
- [ ] Secrets de backup: `SUPABASE_DB_URL` y `BACKUP_PASSPHRASE`
- [ ] Tras una semana sin avisos de CSP en la consola: `CSP_ENFORCE=true`

## Errores: Sentry

1. Crea una cuenta en [sentry.io](https://sentry.io) (el plan gratuito
   alcanza) y un proyecto de tipo **Next.js**.
2. Copia el DSN a `SENTRY_DSN` y `NEXT_PUBLIC_SENTRY_DSN` en Vercel.
3. Opcional, para ver los errores con el código original en lugar de
   minificado: crea un *Auth Token* en Sentry y define
   `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` y `SENTRY_PROJECT`.
4. En Sentry → Alerts, crea una regla "cuando aparezca un issue nuevo,
   enviar email" (o a Slack).

Qué se captura: excepciones del servidor y del navegador, y todo
`console.error` del servidor. Muchos fallos del webhook de WhatsApp y
de la API de Meta se registran así en lugar de lanzar una excepción.

Qué **no** se envía a Sentry: cuerpos de peticiones, cabeceras,
cookies ni datos de usuario, porque contienen mensajes y datos de
clientes. Ojo: el texto de un `console.error` sí viaja tal cual. Si
algún log incluye datos sensibles, revísalo antes de activar Sentry.

## Salud del canal de WhatsApp

`/api/health/whatsapp` se ejecuta cada hora (cron de `vercel.json`) y
revisa cada número conectado:

| Problema | Severidad | Qué hacer |
| --- | --- | --- |
| Token inválido o caducado | crítica | Generar un token nuevo de System User en Meta y guardarlo en Ajustes → WhatsApp |
| Token indescifrable | crítica | Cambió `ENCRYPTION_KEY`; volver a introducir el token |
| WABA sin app suscrita | crítica | Volver a guardar la configuración de WhatsApp |
| Calidad del número en ROJO | crítica | Revisar plantillas/difusiones en WhatsApp Manager; Meta puede limitar el envío |
| Calidad en AMARILLO | aviso | Vigilar: hay quejas o bloqueos de clientes |
| Automatizaciones atrasadas +15 min | crítica | El cron no está corriendo: revisar Vercel → Cron Jobs y `CRON_SECRET` |

Si hay problemas, envía un mensaje a `HEALTH_ALERT_WEBHOOK_URL`:

- **Slack**: Apps → Incoming Webhooks → copiar la URL.
- **Discord**: Canal → Editar → Integraciones → Webhooks → copiar URL.
- **Google Chat**: Espacio → Apps e integraciones → Webhooks.
- **Email / WhatsApp / otros**: un webhook de n8n, Make o Zapier que
  reenvíe el mensaje.

También responde `503` cuando algo falla, así que un monitor externo
(UptimeRobot, Better Stack) puede vigilarlo enviando la cabecera
`x-cron-secret`.

## Copias de seguridad

El workflow `.github/workflows/backup.yml` hace cada día a las 02:30
(hora de Colombia) un `pg_dump` de la base de datos, lo cifra con AES-256
y lo guarda 30 días como artefacto del workflow.

Configuración (GitHub → Settings → Secrets and variables → Actions):

- `SUPABASE_DB_URL`: en Supabase → **Connect** → *Session pooler* →
  URI, con la contraseña de la base de datos. No uses la conexión
  directa (`db.<ref>.supabase.co`): es solo IPv6 y GitHub no llega.
- `BACKUP_PASSPHRASE`: una frase larga aleatoria. **Guárdala fuera del
  repo** (gestor de contraseñas). Sin ella las copias no sirven.

Para probarlo: Actions → Database backup → *Run workflow*.

Restaurar:

```bash
gpg --decrypt wacrm-<fecha>.dump.gpg > wacrm.dump
pg_restore --no-owner --no-privileges -d "<url de la base destino>" wacrm.dump
```

Los archivos subidos (adjuntos, avatares) viven en Supabase Storage y
no entran en este backup.

## Actualizaciones del proyecto original

Cada lunes, `.github/workflows/upstream-check.yml` compara este repo con
`ArnasDon/wacrm` y mantiene abierto un issue con los commits pendientes.
Cuando aparezca:

```bash
git fetch upstream
git merge upstream/main
npm install && npm test
git push
```

Conviene hacerlo pronto: los arreglos de seguridad llegan por ahí.
Cuanto más se espera, más conflictos acumula el merge.

## Integraciones

El CRM trae una API REST y webhooks salientes. Documentación completa
en [public-api.md](public-api.md).

**Crear una API key**: Ajustes → API keys → Nueva, solo con los permisos
(*scopes*) necesarios. La clave se muestra una única vez.

Casos típicos:

- **Formulario web → contacto en el CRM** (`contacts:write`):

  ```bash
  curl -X POST https://tu-dominio/api/v1/contacts \
    -H "Authorization: Bearer wacrm_live_xxx" \
    -H "Content-Type: application/json" \
    -d '{ "phone": "+573001234567", "name": "Ana", "tags": ["web"] }'
  ```

- **Enviar un WhatsApp desde otro sistema** (`messages:send`), por
  ejemplo una confirmación de pedido. Fuera de la ventana de 24 h
  WhatsApp exige una plantilla aprobada (`"type": "template"`):

  ```bash
  curl -X POST https://tu-dominio/api/v1/messages \
    -H "Authorization: Bearer wacrm_live_xxx" \
    -H "Content-Type: application/json" \
    -d '{ "to": "+573001234567", "type": "text", "text": "Tu pedido está listo" }'
  ```

- **Avisar a otro sistema cuando entra un mensaje** (`webhooks:manage`):
  registra un endpoint para `message.received`, `message.status_updated`
  o `conversation.created`. Cada envío va firmado. Verifica la firma con
  el `secret` que devuelve el alta.

Sin programar: n8n, Make y Zapier pueden llamar a la API con un nodo
HTTP y recibir los webhooks.

Dentro del propio CRM, las automatizaciones tienen un paso **Enviar
webhook** para llamar a otro sistema desde un flujo.
