# Bot de WhatsApp de Terranova

El bot usa WAHA y guarda su contenido administrable en SQLite (`terranova.db`). Requiere Node.js 22.5 o posterior.

## Configuración

1. Copia las variables de `.env.example` a `.env` y completa sus valores.
2. Define obligatoriamente una clave segura en `ADMIN_PASSWORD`.
3. Ejecuta `npm start`.
4. Abre `http://localhost:3030/admin/` para administrar el contenido.

El panel permite editar los datos del negocio, horarios, promociones, categorías, productos y precios. Los cambios son consultados por el bot en los siguientes mensajes, sin reiniciarlo.

## Promociones

Los días usan números separados por comas: `0` domingo, `1` lunes, ..., `6` sábado. Una promoción puede tener una fecha específica; en ese caso esa fecha tiene prioridad sobre el día semanal. El horario final es exclusivo y se admiten franjas que cruzan medianoche, por ejemplo `17:00` a `00:00`.

## Verificación

```bash
npm test
```
