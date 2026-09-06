const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { sendMail } = require('./php-mailer');
const mode = process.argv[2];
if (!['verify', 'test'].includes(mode)) {
  console.error('Uso: node mail/cli.js verify|test');
  process.exitCode = 1;
} else {
  sendMail({ subject: 'Terranova — Prueba de alertas de negocio_cz', body: 'Esta es una prueba de las notificaciones del bot negocio_cz mediante PHPMailer.\n\nSi recibes este correo, la entrega a tu buzon funciona.' }, mode === 'verify')
    .then(console.log).catch(error => { console.error(error.message); process.exitCode = 1; });
}
