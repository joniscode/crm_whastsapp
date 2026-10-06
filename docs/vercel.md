# Desplegar wacrm en Vercel

Vercel ejecuta la app como funciones serverless: no hay un proceso
Node siempre vivo como en Docker o en un VPS. La base de datos, la
autenticación y el almacenamiento siguen en Supabase. Esta guía cubre
lo que cambia respecto a un despliegue tradicional.

## Plan de Vercel

- **Pro**: es el que corresponde a un CRM de negocio. El plan Hobby
  prohíbe el uso comercial.
- `vercel.json` programa los dos crons cada 5 minutos. **Hobby solo
  permite crons diarios y rechaza el despliegue** con esta
  configuración. Si vas a probar en Hobby, quita el bloque `crons` y
  usa un servicio externo (ver más abajo).
- Algunas rutas declaran `maxDuration` de hasta 300 s (reanudar una
  difusión). Confirma que tu plan lo permite, o se cortarán antes.

## Pasos

1. **Supabase**: aplica las migraciones de `supabase/migrations` a tu
   proyecto (igual que en cualquier instalación, ver README).
2. **Importar el repo** en Vercel (Add New → Project). Next.js se
   detecta solo; no hace falta cambiar el comando de build.
   `output: "standalone"` de `next.config.ts` no afecta en Vercel.
3. **Variables de entorno** (Project → Settings → Environment
   Variables). Copia las de `.env.local.example`. Como mínimo:

   | Variable | Nota |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
   | `ENCRYPTION_KEY` | 64 caracteres hex. **Usa la misma** que en local si ya guardaste tokens de WhatsApp |
   | `META_APP_SECRET` | Secreto de tu Meta App |
   | `NEXT_PUBLIC_SITE_URL` | `https://tu-dominio` |
   | `NEXT_PUBLIC_APP_LOCALE` | `es` para la interfaz en español (se inyecta en build: redeploy al cambiarla) |
   | `AUTOMATION_CRON_SECRET` y `CRON_SECRET` | El mismo valor aleatorio largo en las dos (`openssl rand -hex 32`) |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Ver "Rate limiting" |
   | `AUTOMATION_TIMEZONE` | `America/Bogota`. Sin ella, la condición "Hora del día" de las automatizaciones usa UTC |
   | `HEALTH_ALERT_WEBHOOK_URL` | Webhook de Slack/Discord/Google Chat para las alertas del chequeo de salud (opcional) |
   | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Monitorización de errores con Sentry (opcional, recomendado) |

4. **Webhook de Meta**: en tu Meta App → WhatsApp → Configuration,
   pon `https://tu-dominio/api/whatsapp/webhook` y suscribe el campo
   `messages`.
5. **Supabase Auth**: en Authentication → URL Configuration, pon tu
   dominio de Vercel como Site URL y añade
   `https://tu-dominio/auth/callback` a Redirect URLs.

## Cron

`vercel.json` llama a `/api/automations/cron` (pasos "Esperar" de las
automatizaciones) y a `/api/flows/cron` (cierra flujos abandonados)
cada 5 minutos. Vercel Cron envía `Authorization: Bearer $CRON_SECRET`
y las rutas aceptan tanto esa cabecera como `x-cron-secret`.

Sin plan Pro, quita `crons` de `vercel.json` y programa esas dos URLs
en un servicio externo (cron-job.org, GitHub Actions, etc.) enviando
la cabecera `x-cron-secret: <AUTOMATION_CRON_SECRET>`.

## Rate limiting

Los límites de peticiones (envío de mensajes, difusiones, IA, API
pública…) se guardan en memoria del proceso. En Vercel cada petición
puede caer en una instancia distinta, así que sin un almacén
compartido los límites prácticamente no se aplican.

Crea una base de datos Redis en Upstash (gratis para este volumen),
directamente o desde Vercel → Storage → Marketplace → Upstash. Las
variables `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` o las
`KV_REST_API_URL`/`KV_REST_API_TOKEN` que inyecta la integración se
detectan solas. Si Redis no está configurado o falla, la app sigue
funcionando con el límite en memoria.

## Limitaciones conocidas

- **Medios entrantes grandes**: los adjuntos recibidos se copian a
  Supabase Storage (Ajustes → WhatsApp → Attachment Storage, activado
  por defecto). Si desactivas esa copia, el inbox los sirve a través
  de `/api/whatsapp/media/<id>`, y Vercel limita las respuestas de
  funciones a ~4.5 MB: vídeos o documentos más grandes no cargarán.
  Mantén la copia activada.
- Las subidas desde el inbox van directas del navegador a Supabase
  Storage, así que el límite de Vercel no les afecta.

## Después del despliegue

Monitorización, alertas, copias de seguridad, actualizaciones del
original e integraciones: ver [operaciones.md](operaciones.md).
