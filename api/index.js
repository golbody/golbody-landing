const https = require('https');
const crypto = require('crypto');

// ===== Env =====
const SUPABASE_HOST = 'quvqqxrfewrsbajsllzk.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dnFxeHJmZXdyc2JhanNsbHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjMyNTAsImV4cCI6MjA5ODk5OTI1MH0.CWkSUpjHFE3wV6vJmCbYmMNv291rEW1SPgkWIO5W6G4';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Modèle de génération d'image. 'nano-banana' = Gemini 2.5 Flash Image (meilleur suivi des
// instructions en langage naturel). Pour revenir à FLUX Kontext : mettre 'flux'.
const GEN_MODEL = process.env.GEN_MODEL || 'nano-banana';

// Stripe products — prix LIVE (compte acct_1TqYtWACVZ6Qm7ic)
// Nouveaux prix LIVE 2026-07-17 : Starter 9,90/99 · Pro 19,90/199 · Ultra 39,90/399 (inchangé)
const PRICE_MAP = {
  starter: { monthly: 'price_1TuDGHACVZ6Qm7icR6OSTUgU', yearly: 'price_1TuDGgACVZ6Qm7icavooNaMa' },
  pro:     { monthly: 'price_1TuDHZACVZ6Qm7icQt36yIvZ', yearly: 'price_1TuDHjACVZ6Qm7icRDgwR4Z7' },
  ultra:   { monthly: 'price_1TsVBrACVZ6Qm7ic4WjD7F3I', yearly: 'price_1TsVBrACVZ6Qm7icmNezIP1V' },
};
const CREDIT_PACKS = {
  small: { amount: 990, credits: 1000, name: 'Recharge' },
  large: { amount: 1990, credits: 2500, name: 'Recharge Max' },
};
const WH_PRICES = {
  // Anciens prix (abonnés existants « grandfathered ») — À GARDER pour leurs renouvellements
  'price_1TsVBqACVZ6Qm7icIBz2xjmO': { plan: 'starter', credits: 1000 },
  'price_1TsVBqACVZ6Qm7icNbxvtCid': { plan: 'starter', credits: 1000 },
  'price_1TsVBqACVZ6Qm7icS9h5wWgD': { plan: 'pro', credits: 3000 },
  'price_1TsVBqACVZ6Qm7icE0rgZLbS': { plan: 'pro', credits: 3000 },
  'price_1TsVBrACVZ6Qm7ic4WjD7F3I': { plan: 'ultra', credits: 7500 },
  'price_1TsVBrACVZ6Qm7icmNezIP1V': { plan: 'ultra', credits: 7500 },
  // Nouveaux prix LIVE 2026-07-17
  'price_1TuDGgACVZ6Qm7icavooNaMa': { plan: 'starter', credits: 1000 },
  'price_1TuDGHACVZ6Qm7icR6OSTUgU': { plan: 'starter', credits: 1000 },
  'price_1TuDHjACVZ6Qm7icRDgwR4Z7': { plan: 'pro', credits: 3000 },
  'price_1TuDHZACVZ6Qm7icQt36yIvZ': { plan: 'pro', credits: 3000 },
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
  let path, payload;
  if (GEN_MODEL === 'nano-banana') {
    // Gemini 2.5 Flash Image (nano-banana) — édition d'image guidée par instruction.
    // image_urls = TABLEAU. safety_tolerance '5' = permissif (photos torse/muscle légitimes
    // sinon bloquées au défaut '4'). Réponse : images[0].url (géré par handleGenerate).
    path = '/fal-ai/nano-banana/edit';
    payload = { prompt, image_urls: [imageUrl], output_format: 'jpeg', aspect_ratio: 'auto', safety_tolerance: '5' };
  } else {
    // FLUX Pro Kontext (repli via GEN_MODEL='flux')
    path = '/fal-ai/flux-pro/kontext';
    payload = { prompt, image_url: imageUrl };
  }
  const body = JSON.stringify(payload);
  const result = await httpsRequest({
    hostname: 'fal.run', path, method: 'POST',
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

  // Crée un nouveau customer Stripe et l'enregistre sur le profil
  async function createCustomer() {
    const c = await stripePost('customers', formEncode({ email: customerEmail, metadata: { user_id } }));
    if (c.status >= 400) throw new Error('Stripe customer: ' + JSON.stringify(c.body));
    await supa('PATCH', `profiles?id=eq.${user_id}`, { stripe_customer_id: c.body.id });
    return c.body.id;
  }

  // customer Stripe : repris du profil, sinon créé
  const pr = await supa('GET', `profiles?id=eq.${user_id}&select=stripe_customer_id`);
  let customerId = (firstRow(pr) && firstRow(pr).stripe_customer_id) || null;
  if (!customerId) customerId = await createCustomer();

  const origin = req.headers.origin || 'https://www.golbody.com';

  // Paramètres de la session selon plan (abonnement) ou pack (achat unique)
  let params;
  if (plan) {
    const priceId = (PRICE_MAP[plan] || {})[billing || 'monthly'] || (PRICE_MAP[plan] || {}).monthly;
    if (!priceId) return res.status(400).json({ error: 'Invalid plan' });
    params = {
      mode: 'subscription', allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard.html?success=true`,
      cancel_url: `${origin}/dashboard.html?canceled=true`,
      metadata: { user_id, plan, billing: billing || 'monthly' },
    };
  } else if (pack) {
    const pd = CREDIT_PACKS[pack];
    if (!pd) return res.status(400).json({ error: 'Invalid pack' });
    params = {
      mode: 'payment', allow_promotion_codes: true,
      line_items: [{ price_data: { currency: 'eur', product_data: { name: pd.name }, unit_amount: pd.amount }, quantity: 1 }],
      success_url: `${origin}/dashboard.html?success=true`,
      cancel_url: `${origin}/dashboard.html?canceled=true`,
      metadata: { user_id, pack, credits: String(pd.credits) },
    };
  } else {
    return res.status(400).json({ error: 'Missing plan or pack' });
  }

  // Crée la session. Si le customer_id stocké est périmé (ancien compte / sandbox →
  // « No such customer »), on recrée un customer et on réessaie UNE fois : auto-réparation,
  // plus besoin de nettoyer le profil à la main.
  const postSession = (cid) => stripePost('checkout/sessions', formEncode({ customer: cid, ...params }));
  let s = await postSession(customerId);
  if (s.status >= 400 && JSON.stringify(s.body || '').includes('No such customer')) {
    customerId = await createCustomer();
    s = await postSession(customerId);
  }
  if (s.status >= 400) throw new Error('Stripe session: ' + JSON.stringify(s.body));
  return res.status(200).json({ url: s.body.url });
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
      const plan = s.metadata && s.metadata.plan;
      const credits = parseInt((s.metadata && s.metadata.credits) || '0', 10);
      if (userId && s.customer) await supa('PATCH', `profiles?id=eq.${userId}`, { stripe_customer_id: s.customer });
      if (pack && credits && userId) {
        const pr = await supa('GET', `profiles?id=eq.${userId}&select=credits`);
        const cur = (firstRow(pr) && firstRow(pr).credits) || 0;
        await supa('PATCH', `profiles?id=eq.${userId}`, { credits: cur + credits });
      } else if (plan && userId) {
        // Abonnement : upgrade immédiat via la metadata du checkout (fiable, sans lookup)
        const PLAN_CREDITS = { starter: 1000, pro: 3000, ultra: 7500 };
        const today = new Date().toISOString().split('T')[0];
        await supa('PATCH', `profiles?id=eq.${userId}`, { plan, credits: PLAN_CREDITS[plan] || 200, stripe_customer_id: s.customer, stripe_subscription_id: s.subscription || null, credits_reset_date: today });
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
      // API récente : inv.subscription peut être absent → on récupère l'abo actif du customer
      let sub = null;
      if (inv.subscription) { const r = await stripeGet('subscriptions/' + inv.subscription); sub = r.body; }
      if ((!sub || !sub.items) && inv.customer) { const r = await stripeGet('subscriptions?customer=' + inv.customer + '&status=active&limit=1'); sub = r.body && r.body.data && r.body.data[0]; }
      if (sub && sub.items && inv.customer) {
        const priceId = sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id || '';
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
// ===== Admin stats =====
const ADMIN_EMAILS = ['jeantondut5@gmail.com'];
const PLAN_PRICE = { starter: 4.90, pro: 17.90, ultra: 39.90 };

async function handleAdminStats(req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
  if (!ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return res.status(403).json({ error: 'Acces refuse' });

  const pr = await supa('GET', 'profiles?select=email,plan,credits,stripe_subscription_id,created_at&order=created_at.desc');
  // Exclut tes comptes perso/test des stats (pour ne voir que les vrais utilisateurs)
  const EXCLUDED = ['jeantondut5@gmail.com', 'feahbaehfba@gmail.com', 'testgolbody@gmail.com'];
  const rows = (Array.isArray(pr.body) ? pr.body : []).filter(r => {
    const e = (r.email || '').toLowerCase();
    return !EXCLUDED.includes(e) && !e.startsWith('golbodytest+');
  });

  const now = new Date();
  const dayMs = 86400000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const byPlan = { free: 0, starter: 0, pro: 0, ultra: 0 };
  let paying = 0, credits = 0, today = 0, d7 = 0, d30 = 0;
  const dayCounts = {};
  for (const r of rows) {
    const plan = r.plan || 'free';
    if (byPlan[plan] === undefined) byPlan[plan] = 0;
    byPlan[plan]++;
    if (plan === 'starter' || plan === 'pro' || plan === 'ultra') paying++;
    credits += (r.credits || 0);
    if (r.created_at) {
      const t = new Date(r.created_at).getTime();
      if (t >= startOfToday) today++;
      if (t >= now.getTime() - 7 * dayMs) d7++;
      if (t >= now.getTime() - 30 * dayMs) d30++;
      const key = new Date(r.created_at).toISOString().slice(0, 10);
      dayCounts[key] = (dayCounts[key] || 0) + 1;
    }
  }
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const key = new Date(startOfToday - i * dayMs).toISOString().slice(0, 10);
    series.push({ date: key, count: dayCounts[key] || 0 });
  }
  const total = rows.length;
  const mrr = byPlan.starter * PLAN_PRICE.starter + byPlan.pro * PLAN_PRICE.pro + byPlan.ultra * PLAN_PRICE.ultra;
  const recent = rows.slice(0, 25).map(r => ({ email: r.email, plan: r.plan || 'free', credits: r.credits || 0, created_at: r.created_at }));

  // ===== Stripe (revenu réel, indépendant de la règle d'annulation) =====
  let salesCount = 0, revenueTotal = 0, activeSubs = 0;
  try {
    const ch = await stripeGet('charges?limit=100');
    for (const c of ((ch.body && ch.body.data) || [])) {
      if (c.status === 'succeeded' && c.paid) { salesCount++; revenueTotal += (c.amount - (c.amount_refunded || 0)); }
    }
    const subs = await stripeGet('subscriptions?status=active&limit=100');
    activeSubs = ((subs.body && subs.body.data) || []).length;
  } catch (e) {}
  revenueTotal = Math.round(revenueTotal) / 100;

  res.status(200).json({
    total, byPlan, paying,
    conversion: total ? paying / total : 0,
    signups: { today, d7, d30 },
    series,
    mrr: Math.round(mrr * 100) / 100,
    arpuTotal: total ? Math.round(mrr / total * 100) / 100 : 0,
    arpuPaying: paying ? Math.round(mrr / paying * 100) / 100 : 0,
    creditsInCirculation: credits,
    stripe: { salesCount, revenueTotal, activeSubs },
    recent,
  });
}

// ===== Enquête (gagne des crédits) =====
async function handleSurveyAnswer(body, req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  const qid = parseInt(body && body.question_id, 10);
  if (isNaN(qid) || qid < 0 || qid > 4) return res.status(400).json({ error: 'Invalid question_id' });
  const answer = String((body && body.answer) || '').slice(0, 1000);
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const reward = (qid >= 0 && qid <= 3) ? 25 : 0; // seules les 4 questions à choix créditent

  async function currentCredits() { const pr = await supa('GET', `profiles?id=eq.${user.id}&select=credits`); return firstRow(pr) ? firstRow(pr).credits : null; }

  // Insert d'abord : la contrainte unique (user, period, question) empêche tout double crédit (anti-race)
  const ins = await supa('POST', 'survey_responses', { user_id: user.id, period, question_id: qid, answer, credited: reward });
  if (ins.status >= 300) {
    return res.status(200).json({ credited: 0, credits: await currentCredits(), already: true });
  }
  let credits = await currentCredits();
  if (reward > 0 && typeof credits === 'number') {
    credits = credits + reward;
    await supa('PATCH', `profiles?id=eq.${user.id}`, { credits });
  }
  res.status(200).json({ credited: reward, credits });
}

// ===== Chat général public =====
const CHAT_ADJ = ['Maxx','Léo','Ryan','Sasha','Nino','Théo','Adam','Kylian','Enzo','Lucas','Noah','Ethan','Gabin','Marius','Naël','Tiago','Axel','Ilan','Rayan','Yanis','Nathan','Hugo','Jules','Malo'];
const CHAT_ANIM = ['Loup','Fauve','Aigle','Tigre','Ours','Faucon','Puma','Lynx','Cobra','Requin','Panthère','Bison','Renard','Taureau','Faon','Rhino','Jaguar','Condor','Élan','Bélier','Aigle','Serpent','Guépard','Hibou'];
function handleForUser(uid) {
  let h = 0; const s = String(uid || '');
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  const a = CHAT_ADJ[h % CHAT_ADJ.length];
  const an = CHAT_ANIM[Math.floor(h / 7) % CHAT_ANIM.length];
  const n = (h % 90) + 10; // 10..99
  return a + '_' + an + '_' + n;
}
function chatClean(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length > 280) t = t.slice(0, 280);
  const low = t.toLowerCase();
  // anti-spam / anti-scam : pas de liens
  if (/https?:\/\/|www\.|\.com|\.fr|\.net|\.io|\.gg|t\.me|discord\.gg/i.test(low)) return { ok: false, reason: 'no_links' };
  // blocklist haine / contenus graves (pas les insultes casual)
  const BAD = ['nigger', 'négro', 'negro', 'bougnoule', 'sale juif', 'sale arabe', 'sale noir', 'sale blanc', 'heil hitler', 'pédophile', 'pedophile', 'zoophil'];
  for (const b of BAD) { if (low.includes(b)) return { ok: false, reason: 'blocked' }; }
  return { ok: true, text: t };
}

async function handleChatGet(req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  const qs = (req.url || '').split('?')[1] || '';
  const after = parseInt(new URLSearchParams(qs).get('after') || '', 10);
  const sel = 'select=id,handle,body,is_seed,created_at';
  let path, reverse = false;
  if (!isNaN(after) && after > 0) {
    path = `chat_messages?id=gt.${after}&order=id.asc&limit=60&${sel}`;
  } else {
    path = `chat_messages?order=id.desc&limit=60&${sel}`;
    reverse = true; // on veut l'ordre chronologique pour l'affichage initial
  }
  const r = await supa('GET', path);
  let rows = Array.isArray(r.body) ? r.body : [];
  if (reverse) rows = rows.reverse();
  res.status(200).json({ messages: rows, me: handleForUser(user.id) });
}

async function handleChatPost(body, req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  const clean = chatClean(body && body.body);
  if (!clean.ok) return res.status(400).json({ error: 'message_rejected', reason: clean.reason });

  // Rate limit : 1 message / 5 s par utilisateur
  const last = await supa('GET', `chat_messages?user_id=eq.${user.id}&order=id.desc&limit=1&select=created_at`);
  const lastRow = firstRow(last);
  if (lastRow && lastRow.created_at) {
    const dt = Date.now() - new Date(lastRow.created_at).getTime();
    if (dt < 5000) return res.status(429).json({ error: 'slow_down' });
  }

  const handle = handleForUser(user.id);
  const ins = await supa('POST', 'chat_messages?select=id,handle,body,is_seed,created_at', { user_id: user.id, handle, body: clean.text });
  const row = firstRow(ins);
  if (!row) return res.status(500).json({ error: 'insert_failed' });
  res.status(200).json({ ok: true, message: row });
}

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
    if (path === '/api/admin-stats' && req.method === 'GET') return await handleAdminStats(req, res);
    if (path === '/api/survey-answer' && req.method === 'POST') return await handleSurveyAnswer(body, req, res);
    if (path === '/api/chat' && req.method === 'GET') return await handleChatGet(req, res);
    if (path === '/api/chat' && req.method === 'POST') return await handleChatPost(body, req, res);

    res.status(404).json({ error: 'Route not found: ' + path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
