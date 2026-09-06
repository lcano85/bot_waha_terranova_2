# Configuracion operativa de Terranova

- La configuracion de referencia esta en waha-config.json. Mantener .env y los webhooks de WAHA alineados con ella.
- Este proyecto usa la sesion negocio_cz, PORT=3032 y WAHA en http://localhost:3031.
- Webhook de mensajes: http://host.docker.internal:3032/webhook/waha, evento message.
- No usar 3033 ni 3034: eran destinos antiguos sin servicio y causaron ECONNREFUSED el 2026-09-06.
- Antes de cambiar puertos o diagnosticar falta de respuestas, ejecutar npm run check:waha y comprobar que el bot escucha en 3032. El estado WORKING de WAHA por si solo no garantiza que el bot reciba mensajes.
- Iniciar con npm start desde esta carpeta, sin sobrescribir PORT. Si se cambia un puerto intencionalmente, actualizar .env, .env.example, waha-config.json, este archivo y el webhook de WAHA conjuntamente.
- No guardar claves API ni contrasenas en documentacion o archivos versionados.

- negocio_cz usa PHPMailer en mail/ y una cola SQLite propia. SMTP: mail.terranovarestobar.com:465 con TLS, usuario info@terranovarestobar.com; destino terranova.restobar.2026@gmail.com. SMTP_PASSWORD solo en .env.
- Validar con npm test, npm run check:waha y npm run mail:verify. npm run mail:test envia correo real. Reiniciar solo el servicio PM2 terranova-bot-2 al cargar cambios.
