const https = require('https');

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dnFxeHJmZXdyc2JhanNsbHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjMyNTAsImV4cCI6MjA5ODk5OTI1MH0.CWkSUpjHFE3wV6vJmCbYmMNv291rEW1SPgkWIO5W6G4';

function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function validateSupabaseToken(token) {
  const result = await httpsRequest({
    hostname: 'quvqqxrfewrsbajsllzk.supabase.co',
    path: '/auth/v1/user',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
  });
  return result.status === 200 ? result.body : null;
}

async function callFalAi(apiKey, imageUrl, prompt) {
  const body = JSON.stringify({ prompt, image_url: imageUrl });
  const result = await httpsRequest({
    hostname: 'fal.run',
    path: '/fal-ai/flux-pro/kontext',
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  if (result.status >= 200 && result.status < 300) return result.body;
  throw new Error(`fal.ai error ${result.status}: ${JSON.stringify(result.body)}`);
}

async function handleGenerate(req, res) {
  const { imageUrl, prompt } = req.body || {};
  if (!imageUrl || !prompt) return res.status(400).json({ error: 'Missing imageUrl or prompt' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  const falKey = process.env.FAL_API_KEY;
  if (!falKey) return res.status(500).json({ error: 'FAL_API_KEY not configured' });

  const result = await callFalAi(falKey, imageUrl, prompt);
  const url = result.images?.[0]?.url || result.image?.url || result.url;
  if (!url) throw new Error('No image URL in fal.ai response: ' + JSON.stringify(result));

  res.status(200).json({ imageUrl: url });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = (req.url || '').split('?')[0].replace(/\/$/, '');

  try {
    if (path === '/api/generate' && req.method === 'POST') {
      return await handleGenerate(req, res);
    }
    res.status(404).json({ error: 'Route not found: ' + path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '25mb' } },
};
