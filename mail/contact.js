async function resolvePhone(chatId, { fetchImpl = fetch } = {}) {
  if (!/^\d+@lid$/.test(chatId)) return null;
  const session = 'negocio_cz';
  const url = `${process.env.WAHA_URL || 'http://localhost:3031'}/api/${session}/lids/${encodeURIComponent(chatId)}`;
  const response = await fetchImpl(url, {
    headers: { 'X-Api-Key': process.env.WAHA_API_KEY || '' },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Consulta de telefono WAHA: HTTP ${response.status}`);
  const data = await response.json();
  if (data.lid !== chatId) return null;
  return /^(\d{7,15})@(?:c\.us|s\.whatsapp\.net)$/.exec(data.pn)?.[1] || null;
}

module.exports = { resolvePhone };
