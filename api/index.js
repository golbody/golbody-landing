const https = require('https');
const crypto = require('crypto');

// ===== Env =====
const SUPABASE_HOST = 'quvqqxrfewrsbajsllzk.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dnFxeHJmZXdyc2JhanNsbHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjMyNTAsImV4cCI6MjA5ODk5OTI1MH0.CWkSUpjHFE3wV6vJmCbYmMNv291rEW1SPgkWIO5W6G4';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Modèle de génération d'image.
//  'flux-max' = FLUX Pro Kontext MAX (choisi : muscle réaliste, visage préservé — testé 2026-07-18).
//  'flux'     = FLUX Pro Kontext (base, moins cher mais muscle plus caricatural).
//  'nano-banana' = Gemini 2.5 Flash Image : ABANDONNÉ (refuse les éditions du corps, renvoie l'image inchangée).
// Surchargeable sans redéployer via l'env var GEN_MODEL sur Vercel.
const GEN_MODEL = process.env.GEN_MODEL || 'flux-max';

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
// Snap Rouge — déblocage à vie (paiement unique, montant inline → aucun prix Stripe à créer).
// Accès accordé aussi aux abonnés pro/ultra (voir handleSnapTutorial).
const SNAP_PRICE = 900; // 9,00 € one-time
const SNAP_PLANS = ['pro', 'ultra']; // abonnements qui incluent le Snap Rouge
const SNAP_STEPS = [
  { n: 1, emoji: '👻', label: 'Étape 1', title: 'Ouvre Snapchat', text: "Clique sur l'icône des filtres dans l'appareil Snapchat." },
  { n: 2, emoji: '🔍', label: 'Étape 2', title: 'Exploration', text: 'Ensuite, clique sur la barre de recherche des filtres.' },
  { n: 3, emoji: '⌨️', label: 'Étape 3', title: 'Recherche', text: 'Une fois dans la barre de recherche, tape : UP' },
  { n: 4, emoji: '🎞️', label: 'Étape 4', title: 'Sélection du filtre', text: "Clique sur le premier filtre 'Camera Roll' qui apparaît." },
  { n: 5, emoji: '🖼️', label: 'Étape 5', title: 'Choix de la photo', text: 'Choisis la photo de ton choix dans ta galerie que tu souhaites envoyer.' },
  { n: 6, emoji: '📸', label: 'Étape 6', title: 'Capture', text: 'Maintenant, appuie sur le bouton pour prendre la photo.' },
  { n: 7, emoji: '🔄', label: 'Étape 7', title: 'Finalisation', text: "Relance l'application si nécessaire pour valider le filtre." },
  { n: 8, emoji: '📤', label: 'Étape 8', title: 'Envoi', text: "Appuie sur 'Envoyer à' pour choisir tes destinataires." },
  { n: 9, emoji: '✅', label: 'Étape 9', title: "C'est prêt !", text: "Choisis à qui l'envoyer et le snap s'enverra sans aucun filtre, comme un vrai snap rouge !" },
];
// Questionnaire feedback « Gagne 300 crédits » (1× par compte, réponses développées)
const FEEDBACK_REWARD = 300;
const FEEDBACK_MIN_CHARS = 15; // longueur minimale par réponse (et pour le message)
const FEEDBACK_Q_COUNT = 15;   // nombre de questions attendues
// Concours du mois (tirage au sort) — réservé aux clients, tirage auto fin de mois
const CONTEST_PRIZE = 300;                                   // crédits par gagnant
const CONTEST_WINNERS = 3;                                   // nombre de gagnants
const CONTEST_TICKETS = { starter: 200, pro: 600, ultra: 1500 }; // tickets = chances (free = non éligible)
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
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
    // Gemini 2.5 Flash Image (nano-banana) — ABANDONNÉ (refuse les éditions du corps). Repli seulement.
    path = '/fal-ai/nano-banana/edit';
    payload = { prompt, image_urls: [imageUrl], output_format: 'jpeg', aspect_ratio: 'auto', safety_tolerance: '5' };
  } else if (GEN_MODEL === 'flux') {
    // FLUX Pro Kontext (base) — repli moins cher
    path = '/fal-ai/flux-pro/kontext';
    payload = { prompt, image_url: imageUrl };
  } else {
    // FLUX Pro Kontext MAX (défaut) — muscle réaliste + visage préservé. Réponse images[0].url.
    path = '/fal-ai/flux-pro/kontext/max';
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
  const cr = await supa('GET', `profiles?id=eq.${user.id}&select=credits,loyalty_credits,bonus_credits`);
  const cprofile = firstRow(cr);
  if (!cprofile) return res.status(403).json({ error: 'Profil introuvable' });
  const credits = cprofile.credits || 0;
  const loyalty = cprofile.loyalty_credits || 0;
  const bonus = cprofile.bonus_credits || 0;
  // On peut générer si plan + cagnotte + bonus (gagnés) >= 100
  if (credits + loyalty + bonus < 100) return res.status(402).json({ error: 'Crédits insuffisants', credits, loyalty_credits: loyalty, bonus_credits: bonus });

  const result = await callFalAi(falKey, imageUrl, prompt);
  const url = result.images?.[0]?.url || result.image?.url || result.url;
  if (!url) throw new Error('No image URL in fal.ai response: ' + JSON.stringify(result));

  // Déduction des 100 crédits : plan → cagnotte → bonus
  let need = 100;
  const fromPlan = Math.min(need, credits); need -= fromPlan;
  const fromLoyalty = Math.min(need, loyalty); need -= fromLoyalty;
  const fromBonus = Math.min(need, bonus); need -= fromBonus;
  const newCredits = credits - fromPlan;
  const newLoyalty = loyalty - fromLoyalty;
  const newBonus = bonus - fromBonus;
  await supa('PATCH', `profiles?id=eq.${user.id}`, { credits: newCredits, loyalty_credits: newLoyalty, bonus_credits: newBonus });

  res.status(200).json({ imageUrl: url, credits: newCredits, loyalty_credits: newLoyalty, bonus_credits: newBonus });
}

async function handleCheckout(body, req, res) {
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured' });
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const { plan, billing, pack, type, customerEmail, user_id } = body || {};
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
  } else if (type === 'snap') {
    // Déblocage Snap Rouge à vie : paiement unique 9 €, montant inline (pas de prix Stripe pré-créé)
    params = {
      mode: 'payment', allow_promotion_codes: true,
      line_items: [{ price_data: { currency: 'eur', product_data: { name: 'Snap Rouge — Accès à vie' }, unit_amount: SNAP_PRICE }, quantity: 1 }],
      success_url: `${origin}/dashboard.html?success=true&tab=snap`,
      cancel_url: `${origin}/dashboard.html?canceled=true&tab=snap`,
      metadata: { user_id, type: 'snap' },
    };
  } else {
    return res.status(400).json({ error: 'Missing plan, pack or type' });
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
      const type = s.metadata && s.metadata.type;
      if (userId && s.customer) await supa('PATCH', `profiles?id=eq.${userId}`, { stripe_customer_id: s.customer });
      if (type === 'snap' && userId) {
        // Déblocage Snap Rouge à vie (paiement unique 9 €) — indépendant du plan, conservé à l'annulation
        await supa('PATCH', `profiles?id=eq.${userId}`, { snap_access: true });
      } else if (pack && credits && userId) {
        const pr = await supa('GET', `profiles?id=eq.${userId}&select=credits`);
        const cur = (firstRow(pr) && firstRow(pr).credits) || 0;
        await supa('PATCH', `profiles?id=eq.${userId}`, { credits: cur + credits });
      } else if (plan && userId) {
        // Abonnement : upgrade immédiat via la metadata du checkout (fiable, sans lookup)
        const PLAN_CREDITS = { starter: 1000, pro: 3000, ultra: 7500 };
        const today = new Date().toISOString().split('T')[0];
        await supa('PATCH', `profiles?id=eq.${userId}`, { plan, credits: PLAN_CREDITS[plan] || 200, stripe_customer_id: s.customer, stripe_subscription_id: s.subscription || null, credits_reset_date: today });

        // Récompense parrainage : au 1er paiement du filleul, on crédite le parrain (une seule fois)
        const fR = await supa('GET', `profiles?id=eq.${userId}&select=referred_by,referral_rewarded`);
        const filleul = firstRow(fR);
        if (filleul && filleul.referred_by && !filleul.referral_rewarded) {
          const spR = await supa('GET', `profiles?referral_code=eq.${filleul.referred_by}&select=id,bonus_credits,referral_earned`);
          const parrain = firstRow(spR);
          if (parrain && parrain.id !== userId) {
            const reward = REFERRAL_REWARD[plan] || 0;
            if (reward > 0) {
              await supa('PATCH', `profiles?id=eq.${parrain.id}`, {
                bonus_credits: (parrain.bonus_credits || 0) + reward,
                referral_earned: (parrain.referral_earned || 0) + reward,
              });
              await supa('PATCH', `profiles?id=eq.${userId}`, { referral_rewarded: true });
            }
          }
        }
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      // Annulation demandée (fin de période) ou statut terminal → 0 crédit + plan gratuit IMMÉDIATEMENT
      const canceling = sub.cancel_at_period_end === true || sub.cancel_at != null || sub.canceled_at != null || ['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status);
      if (canceling) {
        const profiles = await findProfileIdsByCustomer(sub.customer);
        for (const p of profiles) {
          await supa('PATCH', `profiles?id=eq.${p.id}`, { plan: 'free', stripe_subscription_id: null, credits: 0, credits_reset_date: null, loyalty_credits: 0, loyalty_months: 0 });
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
        await supa('PATCH', `profiles?id=eq.${p.id}`, { plan: 'free', stripe_subscription_id: null, credits: 0, credits_reset_date: null, loyalty_credits: 0, loyalty_months: 0 });
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
        const pr = await supa('GET', `profiles?stripe_customer_id=eq.${inv.customer}&select=id,loyalty_months,loyalty_credits`);
        for (const p of (Array.isArray(pr.body) ? pr.body : [])) {
          // Cagnotte fidélité : mois N → +N générations (plafonné à +5/mois). S'accumule, perdue à l'annulation.
          const months = (p.loyalty_months || 0) + 1;
          const bonus = Math.min(months, 5) * 100;
          const newLoyalty = (p.loyalty_credits || 0) + bonus;
          await supa('PATCH', `profiles?id=eq.${p.id}`, { plan: info.plan, credits: info.credits, credits_reset_date: today, loyalty_months: months, loyalty_credits: newLoyalty });
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

// ===== Parrainage « Invite et Gagne » =====
function genRefCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans I,O,0,1,L (ambigus)
  const b = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[b[i] % alphabet.length];
  return s;
}
function maskEmail(email) {
  if (!email || email.indexOf('@') < 0) return 'utilisateur';
  const [u, d] = email.split('@');
  return (u[0] || '') + '***@' + d;
}
const REFERRAL_REWARD = { starter: 1000, pro: 2000, ultra: 4000 };

async function handleReferralInfo(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });

  const meR = await supa('GET', `profiles?id=eq.${user.id}&select=referral_code,referral_earned`);
  const me = firstRow(meR) || {};
  let code = me.referral_code;
  if (!code) {
    for (let i = 0; i < 5 && !code; i++) {
      const cand = genRefCode();
      const exists = await supa('GET', `profiles?referral_code=eq.${cand}&select=id`);
      if (!(Array.isArray(exists.body) && exists.body.length)) {
        await supa('PATCH', `profiles?id=eq.${user.id}`, { referral_code: cand });
        code = cand;
      }
    }
  }
  const filleulsR = await supa('GET', `profiles?referred_by=eq.${code}&select=email,plan,referral_rewarded`);
  const rows = Array.isArray(filleulsR.body) ? filleulsR.body : [];
  const subscribed = rows.filter(r => r.referral_rewarded).length;
  const filleuls = rows.map(r => ({
    emailMasked: maskEmail(r.email),
    status: r.referral_rewarded ? 'abonné' : 'inscrit',
    reward: r.referral_rewarded ? (REFERRAL_REWARD[r.plan] || 0) : 0,
  }));
  res.status(200).json({
    code,
    link: `https://www.golbody.com/register.html?ref=${code}`,
    stats: { subscribed, earned: me.referral_earned || 0, signups: rows.length, pending: rows.length - subscribed },
    filleuls,
  });
}

async function handleReferralAttribute(body, req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const code = (body && body.code || '').toString().trim().toUpperCase();
  if (!code) return res.status(200).json({ ok: false });

  const meR = await supa('GET', `profiles?id=eq.${user.id}&select=referred_by,plan,stripe_customer_id`);
  const me = firstRow(meR);
  if (!me || me.referred_by || (me.plan && me.plan !== 'free') || me.stripe_customer_id) {
    return res.status(200).json({ ok: false });
  }
  const ownerR = await supa('GET', `profiles?referral_code=eq.${code}&select=id`);
  const owner = firstRow(ownerR);
  if (!owner || owner.id === user.id) return res.status(200).json({ ok: false });

  await supa('PATCH', `profiles?id=eq.${user.id}`, { referred_by: code });
  res.status(200).json({ ok: true });
}

// ===== Snap Rouge (tutoriel verrouillé) =====
async function handleSnapTutorial(req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  const pr = await supa('GET', `profiles?id=eq.${user.id}&select=plan,snap_access`);
  const p = firstRow(pr) || {};
  const viaPlan = SNAP_PLANS.includes(p.plan);       // Pro / Ultra → inclus
  const viaPurchase = p.snap_access === true;         // a payé les 9 € à vie
  if (!viaPlan && !viaPurchase) {
    // Verrouillé : on ne renvoie AUCUNE étape (contenu non exposé)
    return res.status(402).json({ access: false });
  }
  return res.status(200).json({ access: true, source: viaPlan ? 'plan' : 'purchase', steps: SNAP_STEPS });
}

// ===== Questionnaire feedback « Gagne 300 crédits » (1× par compte) =====
async function handleFeedbackGet(req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
  const r = await supa('GET', `feedback_responses?user_id=eq.${user.id}&select=user_id`);
  return res.status(200).json({ done: !!firstRow(r), reward: FEEDBACK_REWARD });
}

async function handleFeedbackPost(body, req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  // ---- Validation SERVEUR (non contournable) : 15 réponses ≥ 15 car + note 1-5 + message ≥ 15 ----
  const answers = (body && body.answers) || [];
  if (!Array.isArray(answers) || answers.length !== FEEDBACK_Q_COUNT) return res.status(400).json({ error: 'invalid_answers', reason: 'count' });
  const clean = [];
  for (let k = 0; k < answers.length; k++) {
    const item = answers[k] || {};
    const q = String(item.q == null ? '' : item.q).slice(0, 300);
    const a = String(item.a == null ? '' : item.a).trim();
    if (a.length < FEEDBACK_MIN_CHARS) return res.status(400).json({ error: 'answer_too_short', index: k });
    clean.push({ q, a: a.slice(0, 2000) });
  }
  const rating = parseInt(body && body.rating, 10);
  if (isNaN(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'invalid_rating' });
  const message = String((body && body.message) || '').trim();
  if (message.length < FEEDBACK_MIN_CHARS) return res.status(400).json({ error: 'message_too_short' });

  async function currentCredits() { const pr = await supa('GET', `profiles?id=eq.${user.id}&select=credits`); return firstRow(pr) ? firstRow(pr).credits : null; }

  // Insert-first : PK user_id → toute 2e soumission échoue (anti double-crédit / anti-race)
  const ins = await supa('POST', 'feedback_responses', { user_id: user.id, answers: clean, rating, message: message.slice(0, 4000), credited: FEEDBACK_REWARD });
  if (ins.status >= 300) return res.status(200).json({ credited: 0, credits: await currentCredits(), already: true });

  let credits = await currentCredits();
  if (typeof credits === 'number') {
    credits = credits + FEEDBACK_REWARD;
    await supa('PATCH', `profiles?id=eq.${user.id}`, { credits });
  }
  return res.status(200).json({ credited: FEEDBACK_REWARD, credits });
}

// ===== Concours du mois (tirage au sort) =====
function contestPeriod(d) { return d.toISOString().slice(0, 7); } // 'YYYY-MM' (UTC)
function prevPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return py + '-' + String(pm).padStart(2, '0');
}
function periodEndsAt(period) {
  const [y, m] = period.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return new Date(Date.UTC(ny, nm - 1, 1, 0, 0, 0)).toISOString(); // 1er du mois suivant 00:00 UTC
}
function monthLabelFr(period) {
  const [y, m] = period.split('-').map(Number);
  const name = MONTHS_FR[m - 1] || '';
  return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + y;
}
function weightedPick(entries, k) {
  const pool = entries.map(e => ({ user_id: e.user_id, handle: e.handle, w: Math.max(1, e.tickets || 1) }));
  const winners = [];
  for (let i = 0; i < k && pool.length; i++) {
    const total = pool.reduce((s, e) => s + e.w, 0);
    let r = Math.random() * total, idx = 0;
    for (; idx < pool.length; idx++) { r -= pool[idx].w; if (r <= 0) break; }
    if (idx >= pool.length) idx = pool.length - 1;
    winners.push(pool[idx]); pool.splice(idx, 1);
  }
  return winners;
}
// Tirage paresseux + idempotent d'un mois terminé (lock = insert du gagnant rank 1).
async function maybeDrawPeriod(period) {
  try {
    const already = await supa('GET', `contest_winners?period=eq.${period}&select=rank&limit=1`);
    if (firstRow(already)) return; // déjà tiré
    const eR = await supa('GET', `contest_entries?period=eq.${period}&select=user_id,tickets,handle`);
    const entries = Array.isArray(eR.body) ? eR.body : [];
    if (!entries.length) return; // aucun participant
    const winners = weightedPick(entries, CONTEST_WINNERS);
    // Lock : le 1er insert (period, rank 1) fait office de verrou anti double-tirage
    const lock = await supa('POST', 'contest_winners', { period, rank: 1, user_id: winners[0].user_id, handle: winners[0].handle, credited: CONTEST_PRIZE });
    if (lock.status >= 300) return; // un autre process a déjà tiré → on s'arrête
    for (let i = 1; i < winners.length; i++) {
      await supa('POST', 'contest_winners', { period, rank: i + 1, user_id: winners[i].user_id, handle: winners[i].handle, credited: CONTEST_PRIZE });
    }
    // Crédite chaque gagnant
    for (const w of winners) {
      const pr = await supa('GET', `profiles?id=eq.${w.user_id}&select=credits`);
      const cur = firstRow(pr) ? (firstRow(pr).credits || 0) : null;
      if (typeof cur === 'number') await supa('PATCH', `profiles?id=eq.${w.user_id}`, { credits: cur + CONTEST_PRIZE });
    }
  } catch (e) { console.error('contest draw error:', e); }
}

async function handleContestGet(req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  const now = new Date();
  const period = contestPeriod(now);
  await maybeDrawPeriod(prevPeriod(period)); // tire le mois précédent si pas encore fait

  const meR = await supa('GET', `profiles?id=eq.${user.id}&select=plan`);
  const plan = (firstRow(meR) && firstRow(meR).plan) || 'free';
  const eligible = CONTEST_TICKETS[plan] != null;

  const myE = await supa('GET', `contest_entries?user_id=eq.${user.id}&period=eq.${period}&select=tickets`);
  const myRow = firstRow(myE);
  const joined = !!myRow;
  const myTickets = joined ? myRow.tickets : (eligible ? CONTEST_TICKETS[plan] : 0);

  const partsR = await supa('GET', `contest_entries?period=eq.${period}&select=handle&order=created_at.desc`);
  const parts = Array.isArray(partsR.body) ? partsR.body : [];
  const participants = parts.slice(0, 18).map(p => ({ handle: p.handle || 'Membre' }));

  // Derniers résultats : gagnants du mois le plus récemment tiré
  const winR = await supa('GET', 'contest_winners?select=period,rank,handle&order=period.desc,rank.asc&limit=3');
  const wrows = Array.isArray(winR.body) ? winR.body : [];
  let results = null;
  if (wrows.length) {
    const wp = wrows[0].period;
    results = { period: wp, monthLabel: monthLabelFr(wp), winners: wrows.filter(w => w.period === wp).sort((a, b) => a.rank - b.rank).map(w => ({ rank: w.rank, handle: w.handle || 'Gagnant' })) };
  }

  return res.status(200).json({
    period, monthLabel: monthLabelFr(period), endsAt: periodEndsAt(period), serverNow: now.toISOString(),
    prize: CONTEST_PRIZE, winnersCount: CONTEST_WINNERS,
    plan, eligible, joined, myTickets, ticketTiers: CONTEST_TICKETS,
    participants, participantCount: parts.length, results,
  });
}

async function handleContestJoin(body, req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  const meR = await supa('GET', `profiles?id=eq.${user.id}&select=plan`);
  const plan = (firstRow(meR) && firstRow(meR).plan) || 'free';
  const tickets = CONTEST_TICKETS[plan];
  if (tickets == null) return res.status(403).json({ error: 'not_eligible', plan }); // gratuit → non éligible

  const period = contestPeriod(new Date());
  const handle = handleForUser(user.id);
  const ins = await supa('POST', 'contest_entries', { user_id: user.id, period, tickets, handle });
  if (ins.status >= 300) {
    // Déjà inscrit → on met à jour les tickets (le plan a pu changer)
    await supa('PATCH', `contest_entries?user_id=eq.${user.id}&period=eq.${period}`, { tickets, handle });
  }
  return res.status(200).json({ joined: true, tickets, period });
}

async function handleContestLeave(body, req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await validateSupabaseToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
  const period = contestPeriod(new Date());
  await supa('DELETE', `contest_entries?user_id=eq.${user.id}&period=eq.${period}`);
  return res.status(200).json({ left: true, period });
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
    if (path === '/api/referral-info' && req.method === 'GET') return await handleReferralInfo(req, res);
    if (path === '/api/referral-attribute' && req.method === 'POST') return await handleReferralAttribute(body, req, res);
    if (path === '/api/chat' && req.method === 'GET') return await handleChatGet(req, res);
    if (path === '/api/chat' && req.method === 'POST') return await handleChatPost(body, req, res);
    if (path === '/api/snap-tutorial' && req.method === 'GET') return await handleSnapTutorial(req, res);
    if (path === '/api/feedback' && req.method === 'GET') return await handleFeedbackGet(req, res);
    if (path === '/api/feedback' && req.method === 'POST') return await handleFeedbackPost(body, req, res);
    if (path === '/api/contest' && req.method === 'GET') return await handleContestGet(req, res);
    if (path === '/api/contest/join' && req.method === 'POST') return await handleContestJoin(body, req, res);
    if (path === '/api/contest/leave' && req.method === 'POST') return await handleContestLeave(body, req, res);

    res.status(404).json({ error: 'Route not found: ' + path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
