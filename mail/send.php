<?php
declare(strict_types=1);

use PHPMailer\PHPMailer\PHPMailer;

require __DIR__ . '/../vendor/autoload.php';

try {
    if (!getenv('SMTP_PASSWORD')) {
        throw new RuntimeException('Falta SMTP_PASSWORD en .env');
    }
    $mail = new PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = getenv('SMTP_HOST') ?: 'mail.terranovarestobar.com';
    $mail->Port = (int) (getenv('SMTP_PORT') ?: 465);
    $mail->SMTPAuth = true;
    $mail->Username = getenv('SMTP_USER') ?: 'info@terranovarestobar.com';
    $mail->Password = getenv('SMTP_PASSWORD');
    $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
    $mail->Timeout = 30;
    $mail->CharSet = 'UTF-8';
    $mail->setFrom($mail->Username, 'Terranova Restobar');
    $mail->addAddress(getenv('ALERT_EMAIL_TO') ?: 'terranova.restobar.2026@gmail.com');
    if (($argv[1] ?? '') === '--verify') {
        if (!$mail->smtpConnect()) throw new RuntimeException('No se pudo conectar al SMTP');
        $mail->smtpClose();
        echo "SMTP autenticado correctamente\n";
        exit(0);
    }
    $input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
    $mail->Subject = $input['subject'];
    $mail->Body = $input['body'];
    $mail->isHTML(false);
    $mail->send();
    echo "Correo aceptado por el servidor SMTP\n";
} catch (Throwable $error) {
    // Never expose SMTP credentials or SMTP protocol transcripts.
    fwrite(STDERR, "Fallo de correo: " . str_replace(getenv('SMTP_PASSWORD') ?: '__unset__', '[oculto]', $error->getMessage()) . "\n");
    exit(1);
}
