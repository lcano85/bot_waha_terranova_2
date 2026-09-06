# Bot de WhatsApp de Terranova

El bot usa WAHA y guarda su contenido administrable en SQLite (`terranova.db`). Requiere Node.js 22.5 o posterior.

## Configuración

1. Copia las variables de `.env.example` a `.env` y completa sus valores.
2. Define obligatoriamente una clave segura en `ADMIN_PASSWORD`.
3. Ejecuta `npm start`.
4. Abre `http://localhost:3032/admin/` para administrar el contenido.

El panel permite editar los datos del negocio, horarios, promociones, categorías, productos y precios. Los cambios son consultados por el bot en los siguientes mensajes, sin reiniciarlo.

## Promociones

Los días usan números separados por comas: `0` domingo, `1` lunes, ..., `6` sábado. Una promoción puede tener una fecha específica; en ese caso esa fecha tiene prioridad sobre el día semanal. El horario final es exclusivo y se admiten franjas que cruzan medianoche, por ejemplo `17:00` a `00:00`.

## Verificación

```bash
npm test
```

## Configuracion operativa guardada

Sesion: `negocio_cz`. Puerto del bot: **3032**. WAHA: `http://localhost:3031`.
Webhook: `http://host.docker.internal:3032/webhook/waha`, evento `message`.

La referencia persistente esta en `waha-config.json`. Los puertos antiguos 3033 y 3034 causaban conexion rechazada. Inicia este bot con `npm start` desde su carpeta, sin sobrescribir PORT.

Ejecuta `npm run check:waha` para comprobar las variables efectivas, el webhook guardado en WAHA y el estado de la sesion. Esta comprobacion es de solo lectura; no envia mensajes ni modifica sesiones. No sustituye una prueba de respuesta en WhatsApp ni comprueba que el proceso del bot siga vivo.

Si cambias de puerto, actualiza conjuntamente .env, .env.example, waha-config.json, AGENTS.md y el webhook de WAHA.

## Alertas por correo (negocio_cz)

PHPMailer se instala con `composer install`; se requiere PHP con OpenSSL y Composer para instalar dependencias. Node ejecuta `mail/send.php` como proceso local, sin publicar un endpoint PHP. Referencia: https://github.com/PHPMailer/PHPMailer.

La configuracion local en `.env` usa `SMTP_HOST=mail.terranovarestobar.com`, `SMTP_PORT=465` (TLS implicito), `SMTP_USER=info@terranovarestobar.com`, `ALERT_EMAIL_TO=terranova.restobar.2026@gmail.com` y `EMAIL_ALERTS_ENABLED=true`. Completar `SMTP_PASSWORD` con la clave del buzon emisor; nunca versionarla. `PHP_BIN` indica la ruta al ejecutable PHP.

- `npm run mail:verify`: verifica autenticacion SMTP sin enviar correo.
- `npm run mail:test`: envia un correo de prueba al destinatario configurado.
- `npm test`: prueba filtros, deduplicacion, intervalos y reintentos sin enviar correos.
- Reiniciar el bot despues de cambiar `.env`. `EMAIL_ALERTS_ENABLED=false` desactiva nuevas alertas y el envio de las pendientes.

Se avisa en el primer mensaje y tras 30 minutos sin actividad del cliente. Los pedidos y solicitudes de asesor generan aviso inmediato. Los mensajes sin texto tambien pueden iniciar una alerta. Se ignoran grupos, estados, mensajes propios y otras sesiones. Un identificador `@lid` se muestra como identificador, nunca como telefono.

Las alertas pendientes y los identificadores de eventos se guardan en SQLite para sobrevivir reinicios. El envio se procesa cada 10 segundos sin bloquear las respuestas del bot. Si falta la clave SMTP, se conservan pendientes sin consumir intentos. Los fallos se reintentan hasta ocho veces con espera creciente; luego quedan como `failed` en `mail_queue`, y se registran en la consola con prefijo `[correo]`. Los eventos duplicados se recuerdan durante siete dias. El contenido de correos enviados se elimina despues de siete dias al recibir nuevos mensajes. Como con cualquier envio SMTP, una interrupcion despues de la aceptacion del servidor y antes de guardar el resultado puede producir un duplicado en el reintento. La aceptacion SMTP no confirma la llegada a la bandeja de entrada.

La prueba real consiste en enviar un nuevo mensaje al WhatsApp del negocio y comprobar el correo recibido, incluida la carpeta de spam.

Los asuntos de las alertas incluyen [negocio_cz] para distinguir esta cuenta.

### Telefono del contacto en las alertas

Antes de enviar nuevas alertas de contactos @lid se consulta GET /api/negocio_cz/lids/{lid} en WAHA. Si devuelve un telefono valido, se incluye el numero y el enlace https://wa.me/numero. Si no hay numero o la consulta falla, se conserva el identificador. La consulta se realiza en segundo plano, con un limite de cinco segundos. Los correos ya enviados y las alertas antiguas sin metadatos no se modifican.
