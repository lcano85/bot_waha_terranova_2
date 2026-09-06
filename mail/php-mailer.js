const { spawn } = require('node:child_process');
const path = require('node:path');

function sendMail(message, verify = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PHP_BIN || 'php', [path.join(__dirname, 'send.php'), ...(verify ? ['--verify'] : [])], {
      windowsHide: true, shell: false, env: process.env, stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    let errorOutput = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('SMTP excedio 60 segundos')); }, 60000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-2000); });
    child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(-2000); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else reject(new Error(errorOutput.trim() || `PHP termino con codigo ${code}`));
    });
    child.stdin.end(JSON.stringify(message || {}));
  });
}

module.exports = { sendMail };
