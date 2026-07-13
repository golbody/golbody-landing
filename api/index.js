const https = require('https');
const crypto = require('crypto');

// ===== Env =====
const SUPABASE_HOST = 'quvqqxrfewrsbajsllzk.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dnFxeHJmZXdyc2JhanNsbHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjMyNTAsImV4cCI6MjA5ODk5OTI1MH0.CWkSUpjHFE3wV6vJmCbYmMNv291rEW1SPgkWIO5W6G4';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Stripe products — prix LIVE (compte acct_1TqYtWACVZ6Qm7ic)
const PRICE_MAP = {
  starter: { monthly: 'price_1TsVBqACVZ6Qm7icIBz2xjmO', yearly: 'price_1TsVBqACVZ6Qm7icNbxvtCid' },
  pro:     { monthly: 'price_1TsVBqACVZ6Qm7icS9h5wWgD', yearly: 'price_1TsVBqACVZ6Qm7icE0rgZLbS' },
  ultra:   { monthly: 'price_1TsVBrACVZ6Qm7ic4WjD7F3I', yearly: 'price_1TsVBrACVZ6Qm7icmNezIP1V' },
};
const CREDIT_PACKS = {
  small: { amount: 990, credits: 1000, name: 'Recharge' },
  large: { amount: 1990, credits: 2500, name: 'Recharge Max' },
};
const WH_PRICES = {
  'price_1TsVBqACVZ6Qm7icIBz2xjmO': { plan: 'starter', credits: 1000 },
  'price_1TsVBqACVZ6Qm7icNbxvtCid': { plan: 'starter', credits: 1000 },
  'price_1TsVBqACVZ6Qm7icS9h5wWgD': { plan: 'pro', credits: 3000 },
  'price_1TsVBqACVZ6Qm7icE0rgZLbS': { plan: 'pro', credits: 3000 },
  'price_1TsVBrACVZ6Qm7ic4WjD7F3I': { plan: 'ultra', credits: 7500 },
  'price_1TsVBrACVZ6Qm7icmNezIP1V': { plan: 'ultra', credits: 7500 },
};

// ===== HTTP helper =====
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

function readRawBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

// x-www-form-urlencoded avec notation crochets (style Stripe : a[b][c]=)
function formEncode(obj, prefix, out) {
  out = out || [];
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return prefix ? out : out.join('&');
}

// ===== Stripe REST =====
function stripePost(path, formBody) {
  return httpsRequest({
    hostname: 'api.stripe.com', path: '/v1/' + path, method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formBody),
    },
  }, formBody);
}
function stripeGet(path) {
  return httpsRequest({
    hostname: 'api.stripe.com', path: '/v1/' + path, method: 'GET',
    headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY },
  });
}

// ===== Supabase REST (service_role) =====
function supa(method, pathAndQuery, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : null;
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };
  if (method === 'PATCH' || method === 'POST') headers['Prefer'] = 'return=representation';
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  return httpsRequest({ hostname: SUPABASE_HOST, path: '/rest/v1/' + pathAndQuery, method, headers }, body);
}
function firstRow(r) { return (Array.isArray(r.body) && r.body[0]) ? r.body[0] : null; }

// ===== Auth (génération) =====
async function validateSupabaseToken(token) {
  const result = await httpsRequest({
    hostname: SUPABASE_HOST, path: '/auth/v1/user', method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
  });
  return result.status === 200 ? result.body : null;
}

async function callFalAi(apiKey, imageUrl, prompt) {
  const body = JSON.stringify({ prompt, image_url: imageUrl });
  const result = await httpsRequest({
    hostname: 'fal.run', path: '/fal-ai/flux-pro/kontext', method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  if (result.status >= 200 && result.status < 300) return result.body;
  throw new Error(`fal.ai error ${result.status}: ${JSON.stringify(result.body)}`);
}

// ===== Handlers =====
async function handleGenerate(body, req, res) {
  const { imageUrl, prompt } = body || {};
  if (!imageUrl || !prompt) return res.status(400).json({ error: 'Missing imageUrl or prompt' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  const falKey = process.env.FAL_API_KEY;
  if (!falKey) return res.status(500).json({ error: 'FAL_API_KEY not configured' });

  // ===== Contrôle des crédits CÔTÉ SERVEUR (anti-abus, non contournable) =====
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const cr = await supa('GET', `profiles?id=eq.${user.id}&select=credits`);
  const cprofile = firstRow(cr);
  if (!cprofile) return res.status(403).json({ error: 'Profil introuvable' });
  const credits = cprofile.credits || 0;
  if (credits < 100) return res.status(402).json({ error: 'Crédits insuffisants', credits });

  const result = await callFalAi(falKey, imageUrl, prompt);
  const url = result.images?.[0]?.url || result.image?.url || result.url;
  if (!url) throw new Error('No image URL in fal.ai response: ' + JSON.stringify(result));

  // Déduction des 100 crédits APRÈS génération réussie
  const newCredits = credits - 100;
  await supa('PATCH', `profiles?id=eq.${user.id}`, { credits: newCredits });

  res.status(200).json({ imageUrl: url, credits: newCredits });
}

async function handleCheckout(body, req, res) {
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured' });
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const { plan, billing, pack, customerEmail, user_id } = body || {};
  if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

  // customer Stripe
  const pr = await supa('GET', `profiles?id=eq.${user_id}&select=stripe_customer_id`);
  let customerId = firstRow(pr) && firstRow(pr).stripe_customer_id;
  if (!customerId) {
    const c = await stripePost('customers', formEncode({ email: customerEmail, metadata: { user_id } }));
    if (c.status >= 400) throw new Error('Stripe customer: ' + JSON.stringify(c.body));
    customerId = c.body.id;
    await supa('PATCH', `profiles?id=eq.${user_id}`, { stripe_customer_id: customerId });
  }

  const origin = req.headers.origin || 'https://golbody.com';

  if (plan) {
    const priceId = (PRICE_MAP[plan] || {})[billing || 'monthly'] || (PRICE_MAP[plan] || {}).monthly;
    if (!priceId) return res.status(400).json({ error: 'Invalid plan' });
    const s = await stripePost('checkout/sessions', formEncode({
      customer: customerId, mode: 'subscription',
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard.html?success=true`,
      cancel_url: `${origin}/dashboard.html?canceled=true`,
      metadata: { user_id, plan, billing: billing || 'monthly' },
    }));
    if (s.status >= 400) throw new Error('Stripe session: ' + JSON.stringify(s.body));
    return res.status(200).json({ url: s.body.url });
  }

  if (pack) {
    const pd = CREDIT_PACKS[pack];
    if (!pd) return res.status(400).json({ error: 'Invalid pack' });
    const s = await stripePost('checkout/sessions', formEncode({
      customer: customerId, mode: 'payment',
      allow_promotion_codes: true,
      line_items: [{ price_data: { currency: 'eur', product_data: { name: pd.name }, unit_amount: pd.amount }, quantity: 1 }],
      success_url: `${origin}/dashboard.html?success=true`,
      cancel_url: `${origin}/dashboard.html?canceled=true`,
      metadata: { user_id, pack, credits: String(pd.credits) },
    }));
    if (s.status >= 400) throw new Error('Stripe session: ' + JSON.stringify(s.body));
    return res.status(200).json({ url: s.body.url });
  }

  res.status(400).json({ error: 'Missing plan or pack' });
}

async function handlePortal(body, req, res) {
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured' });
  const { user_id } = body || {};
  if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
  const pr = await supa('GET', `profiles?id=eq.${user_id}&select=stripe_customer_id`);
  const customerId = firstRow(pr) && firstRow(pr).stripe_customer_id;
  if (!customerId) return res.status(404).json({ error: 'No Stripe customer' });
  const origin = req.headers.origin || 'https://golbody.com';
  const s = await stripePost('billing_portal/sessions', formEncode({ customer: customerId, return_url: `${origin}/dashboard.html` }));
  if (s.status >= 400) throw new Error('Stripe portal: ' + JSON.stringify(s.body));
  res.status(200).json({ url: s.body.url });
}

async function handleUseCredit(body, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const { userId } = body || {};
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  const pr = await supa('GET', `profiles?id=eq.${userId}&select=credits,plan`);
  const profile = firstRow(pr);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  if ((profile.credits || 0) < 100) return res.status(402).json({ error: 'Credits insuffisants', credits: profile.credits });
  const newCredits = profile.credits - 100;
  await supa('PATCH', `profiles?id=eq.${userId}`, { credits: newCredits });
  res.status(200).json({ success: true, credits: newCredits });
}

async function handleProfile(userId, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const pr = await supa('GET', `profiles?id=eq.${userId}&select=credits,plan,stripe_customer_id,stripe_subscription_id,credits_reset_date`);
  const profile = firstRow(pr);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  res.status(200).json(profile);
}

// ===== Webhook Stripe =====
function verifyStripeSig(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = {};
  sigHeader.split(',').forEach((p) => { const i = p.indexOf('='); if (i > 0) parts[p.slice(0, i)] = p.slice(i + 1); });
  if (!parts.t || !parts.v1) return false;
  const signedPayload = parts.t + '.' + rawBody.toString('utf8');
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Trouve les profils liés à un customer Stripe : par stripe_customer_id, sinon repli par email
async function findProfileIdsByCustomer(customer) {
  let pr = await supa('GET', `profiles?stripe_customer_id=eq.${customer}&select=id`);
  let profiles = Array.isArray(pr.body) ? pr.body : [];
  if (!profiles.length) {
    const cust = await stripeGet('customers/' + customer);
    const email = cust.body && cust.body.email;
    if (email) { const r = await supa('GET', `profiles?email=eq.${encodeURIComponent(email)}&select=id`); profiles = Array.isArray(r.body) ? r.body : []; }
  }
  return profiles;
}

async function handleWebhook(rawBody, req, res) {
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) { res.status(400).send('Stripe not configured'); return; }
  if (!verifyStripeSig(rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)) {
    res.status(400).send('Webhook signature verification failed'); return;
  }
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch { res.status(400).send('Bad JSON'); return; }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = s.metadata && s.metadata.user_id;
      const pack = s.metadata && s.metadata.pack;
      const credits = parseInt((s.metadata && s.metadata.credits) || '0', 10);
      if (userId && s.customer) await supa('PATCH', `profiles?id=eq.${userId}`, { stripe_customer_id: s.customer });
      if (pack && credits && userId) {
        const pr = await supa('GET', `profiles?id=eq.${userId}&select=credits`);
        const cur = (firstRow(pr) && firstRow(pr).credits) || 0;
        await supa('PATCH', `profiles?id=eq.${userId}`, { credits: cur + credits });
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      // Annulation demandée (fin de période) ou statut terminal → 0 crédit + plan gratuit IMMÉDIATEMENT
      const canceling = sub.cancel_at_period_end === true || sub.cancel_at != null || sub.canceled_at != null || ['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status);
      if (canceling) {
        const profiles = await findProfileIdsByCustomer(sub.customer);
        for (const p of profiles) {
          await supa('PATCH', `profiles?id=eq.${p.id}`, { plan: 'free', stripe_subscription_id: null, credits: 0, credits_reset_date: null });
        }
      } else {
        const priceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id || '';
        const info = WH_PRICES[priceId] || { plan: 'free', credits: 200 };
        if (sub.status === 'active' || sub.status === 'trialing') {
          let pr = await supa('GET', `profiles?stripe_customer_id=eq.${sub.customer}&select=id`);
          let profiles = Array.isArray(pr.body) ? pr.body : [];
          if (!profiles.length) {
            const cust = await stripeGet('customers/' + sub.customer);
            const email = cust.body && cust.body.email;
            if (email) { const r = await supa('GET', `profiles?email=eq.${encodeURIComponent(email)}&select=id`); profiles = Array.isArray(r.body) ? r.body : []; }
          }
          const today = new Date().toISOString().split('T')[0];
          for (const p of profiles) {
            await supa('PATCH', `profiles?id=eq.${p.id}`, { plan: info.plan, stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, credits: info.credits, credits_reset_date: today });
          }
        }
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const profiles = await findProfileIdsByCustomer(sub.customer);
      for (const p of profiles) {
        await supa('PATCH', `profiles?id=eq.${p.id}`, { plan: 'free', stripe_subscription_id: null, credits: 0, credits_reset_date: null });
      }
    } else if (event.type === 'invoice.paid') {
      const inv = event.data.object;
      const subId = inv.subscription;
      if (subId) {
        const subR = await stripeGet('subscriptions/' + subId);
        const sub = subR.body || {};
        const priceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id || '';
        const info = WH_PRICES[priceId] || { plan: 'free', credits: 200 };
        const today = new Date().toISOString().split('T')[0];
        const pr = await supa('GET', `profiles?stripe_customer_id=eq.${inv.customer}&select=id`);
        for (const p of (Array.isArray(pr.body) ? pr.body : [])) {
          await supa('PATCH', `profiles?id=eq.${p.id}`, { plan: info.plan, credits: info.credits, credits_reset_date: today });
        }
      }
    }
  } catch (err) { console.error('Webhook error:', err); }
  res.status(200).json({ received: true });
}

// ===== Router =====
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = (req.url || '').split('?')[0].replace(/\/$/, '');

  try {
    const rawBody = req.method === 'POST' ? await readRawBody(req) : Buffer.alloc(0);

    // Webhook : signature sur le corps brut, avant tout parsing
    if (path === '/webhook' && req.method === 'POST') {
      return await handleWebhook(rawBody, req, res);
    }

    let body = {};
    if (rawBody.length) { try { body = JSON.parse(rawBody.toString('utf8')); } catch { body = {}; } }

    if (path === '/api/generate' && req.method === 'POST') return await handleGenerate(body, req, res);
    if (path === '/create-checkout-session' && req.method === 'POST') return await handleCheckout(body, req, res);
    if (path === '/create-portal-session' && req.method === 'POST') return await handlePortal(body, req, res);
    if (path === '/use-credit' && req.method === 'POST') return await handleUseCredit(body, res);
    if (path.startsWith('/profile/') && req.method === 'GET') return await handleProfile(path.split('/').pop(), res);

    res.status(404).json({ error: 'Route not found: ' + path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
