const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const https = require('https');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '/';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Hardcoded Stripe Price IDs
// Monthly prices
const STRIPE_PRICE_STARTER_MONTHLY = 'price_1Tqx3UAa7KFR9IQxMYKKKo0R';
const STRIPE_PRICE_PRO_MONTHLY     = 'price_1Tqx46Aa7KFR9IQxqmcnnpxZ';
const STRIPE_PRICE_ULTRA_MONTHLY   = 'price_1Tqx4LAa7KFR9IQx6VwgnQ6Z';

// Yearly prices
const STRIPE_PRICE_STARTER_YEARLY = 'price_1Tqx6OAa7KFR9IQxuDzFeUp8';
const STRIPE_PRICE_PRO_YEARLY     = 'price_1Tqx72Aa7KFR9IQxWyTp9s0H';
const STRIPE_PRICE_ULTRA_YEARLY   = 'price_1Tqx84Aa7KFR9IQxAZ6WU7mo';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://quvqqxrfewrsbajsllzk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dnFxeHJmZXdyc2JhanNsbHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY4NzUzMzUsImV4cCI6MjA2MjQ1MTMzNX0.kSiwUpjHFE3wV6vJmCbYmMNv291rEW1SPgkWIO5W6G4';

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-06-30.basil' }) : null;
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://quvqqxrfewrsbajsllzk.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY  // service role, pas anon key
);

const PRICE_MAP = {
  starter: { monthly: STRIPE_PRICE_STARTER_MONTHLY, yearly: STRIPE_PRICE_STARTER_YEARLY },
  pro:     { monthly: STRIPE_PRICE_PRO_MONTHLY,     yearly: STRIPE_PRICE_PRO_YEARLY },
  ultra:   { monthly: STRIPE_PRICE_ULTRA_MONTHLY,   yearly: STRIPE_PRICE_ULTRA_YEARLY },
};

function getPriceId(plan, billing) {
  const entry = PRICE_MAP[plan];
  if (!entry) return null;
  return entry[billing] || entry.monthly;
}

const PLAN_CREDITS = {
  free: 100,
  starter: 1000,
  pro: 3000,
  ultra: 7500,
};

const CREDIT_PACKS = {
  small: { amount: 490, credits: 500, name: 'Pack Légère — 5 générations' },
  large: { amount: 1490, credits: 1500, name: 'Pack Max — 15 générations' },
};

const app = express();

// Static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Raw body parser for Stripe webhook
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      console.error('Stripe not configured');
      return res.status(400).send('Stripe not configured');
    }
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Stripe event:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const userId = session.metadata?.user_id;
        const pack = session.metadata?.pack;
        const creditsToAdd = parseInt(session.metadata?.credits, 10);

        if (userId && customerId) {
          await supabase.from('profiles').update({
            stripe_customer_id: customerId,
          }).eq('id', userId);
        }

        // Credit pack purchase — add credits to user's account
        if (pack && creditsToAdd && userId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', userId)
            .single();

          const currentCredits = profile?.credits || 0;
          await supabase.from('profiles').update({
            credits: currentCredits + creditsToAdd,
          }).eq('id', userId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const status = subscription.status;

        // Find plan by price ID (monthly or yearly)
        let plan = 'free';
        let credits = 200;
        if (priceId === STRIPE_PRICE_STARTER_MONTHLY || priceId === STRIPE_PRICE_STARTER_YEARLY) { plan = 'starter'; credits = 1000; }
        else if (priceId === STRIPE_PRICE_PRO_MONTHLY || priceId === STRIPE_PRICE_PRO_YEARLY) { plan = 'pro'; credits = 3000; }
        else if (priceId === STRIPE_PRICE_ULTRA_MONTHLY || priceId === STRIPE_PRICE_ULTRA_YEARLY) { plan = 'ultra'; credits = 7500; }

        if (status === 'active' || status === 'trialing') {
          // Get customer email from Stripe
          const customer = await stripe.customers.retrieve(customerId);
          const email = customer.email;

          // Chercher par stripe_customer_id OU par email
          let { data: profiles } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_customer_id', customerId);

          if (!profiles || profiles.length === 0) {
            const result = await supabase
              .from('profiles')
              .select('id')
              .eq('email', email);
            profiles = result.data;
          }

          if (profiles && profiles.length > 0) {
            for (const p of profiles) {
              await supabase.from('profiles').update({
                plan: plan,
                stripe_customer_id: customerId,
                stripe_subscription_id: subscription.id,
                credits: credits,
                credits_reset_date: new Date().toISOString().split('T')[0],
              }).eq('id', p.id);
            }
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId);

        if (profiles && profiles.length > 0) {
          for (const p of profiles) {
            await supabase.from('profiles').update({
              plan: 'free',
              stripe_subscription_id: null,
              credits: 200,
              credits_reset_date: null,
            }).eq('id', p.id);
          }
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        // Get subscription to find price/plan
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items?.data?.[0]?.price?.id;
        let credits = 200;
        let plan = 'free';
        if (priceId === STRIPE_PRICE_STARTER_MONTHLY || priceId === STRIPE_PRICE_STARTER_YEARLY) { plan = 'starter'; credits = 1000; }
        else if (priceId === STRIPE_PRICE_PRO_MONTHLY || priceId === STRIPE_PRICE_PRO_YEARLY) { plan = 'pro'; credits = 3000; }
        else if (priceId === STRIPE_PRICE_ULTRA_MONTHLY || priceId === STRIPE_PRICE_ULTRA_YEARLY) { plan = 'ultra'; credits = 7500; }

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId);

        if (profiles && profiles.length > 0) {
          for (const p of profiles) {
            await supabase.from('profiles').update({
              plan: plan,
              credits: credits,
              credits_reset_date: new Date().toISOString().split('T')[0],
            }).eq('id', p.id);
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }

  res.json({ received: true });
});

// JSON body parser for all other routes
app.use(bodyParser.json());

// CORS for frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Create checkout session (subscriptions or credit packs)
app.post('/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const { plan, billing, pack, customerEmail, user_id } = req.body;

    // Get or create Stripe customer
    let customerId = null;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user_id)
      .single();

    if (profiles && profiles.stripe_customer_id) {
      customerId = profiles.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: customerEmail,
        metadata: { user_id },
      });
      customerId = customer.id;
      await supabase.from('profiles').update({
        stripe_customer_id: customerId,
      }).eq('id', user_id);
    }

    const origin = req.headers.origin || req.headers.referer || `https://${process.env.REPLIT_DEV_DOMAIN || 'golbody.com'}`;

    // Subscription checkout
    if (plan) {
      const priceId = getPriceId(plan, billing);
      if (!priceId) {
        return res.status(400).json({ error: 'Invalid plan or billing mode' });
      }
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}${BASE_PATH}dashboard.html?success=true`,
        cancel_url: `${origin}${BASE_PATH}dashboard.html?canceled=true`,
        metadata: { user_id, plan, billing: billing || 'monthly' },
      });
      return res.json({ url: session.url });
    }

    // Credit pack one-time checkout
    if (pack) {
      const packData = CREDIT_PACKS[pack];
      if (!packData) {
        return res.status(400).json({ error: 'Invalid credit pack' });
      }
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: { name: packData.name },
            unit_amount: packData.amount,
          },
          quantity: 1,
        }],
        success_url: `${origin}${BASE_PATH}dashboard.html?success=true`,
        cancel_url: `${origin}${BASE_PATH}dashboard.html?canceled=true`,
        metadata: { user_id, pack, credits: packData.credits },
      });
      return res.json({ url: session.url });
    }

    return res.status(400).json({ error: 'Missing plan or pack' });
  } catch (err) {
    console.error('Checkout session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Credits check endpoint
app.post('/use-credit', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('credits, plan')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (profile.credits < 100) {
      return res.status(402).json({ error: 'Crédits insuffisants — upgradez votre plan', credits: profile.credits });
    }

    const newCredits = profile.credits - 100;
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ credits: newCredits })
      .eq('id', userId);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true, credits: newCredits });
  } catch (err) {
    console.error('Use credit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create Stripe portal session
app.post('/create-portal-session', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id' });
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user_id)
      .single();

    if (error || !profile || !profile.stripe_customer_id) {
      return res.status(404).json({ error: 'No Stripe customer found for this user' });
    }

    const origin = req.headers.origin || req.headers.referer || `https://${process.env.REPLIT_DEV_DOMAIN || 'golbody.com'}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}${BASE_PATH}dashboard.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get profile endpoint
app.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('credits, plan, stripe_customer_id, stripe_subscription_id, credits_reset_date')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Native HTTPS helpers ---
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
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
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
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
  if (result.status >= 200 && result.status < 300) {
    return result.body;
  }
  throw new Error(`fal.ai error ${result.status}: ${JSON.stringify(result.body)}`);
}

// POST /api/generate — proxy image generation through fal.ai
app.post('/api/generate', async (req, res) => {
  try {
    const { imageUrl, prompt } = req.body;
    if (!imageUrl || !prompt) {
      return res.status(400).json({ error: 'Missing imageUrl or prompt' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const user = await validateSupabaseToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const falKey = process.env.FAL_API_KEY;
    if (!falKey) {
      return res.status(500).json({ error: 'FAL_API_KEY not configured' });
    }

    const result = await callFalAi(falKey, imageUrl, prompt);
    res.json(result);
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.status(404).send('Not found');
      } else {
        res.status(500).send('Server error');
      }
      return;
    }
    res.setHeader('Content-Type', contentType);
    // Force no-cache for HTML files to prevent stale auth redirects in browser cache
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    res.send(data);
  });
}

app.use((req, res) => {
  let urlPath = req.url;
  if (BASE_PATH !== '/' && urlPath.startsWith(BASE_PATH)) {
    urlPath = urlPath.slice(BASE_PATH.length) || '/';
  }

  const cleanPath = urlPath.split('?')[0].split('#')[0];
  let filePath = cleanPath === '/' ? 'index.html' : cleanPath;
  filePath = path.join(__dirname, filePath);

  if (!filePath.startsWith(__dirname)) {
    return res.status(403).send('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(filePath, 'index.html');
      fs.stat(indexPath, (idxErr, idxStats) => {
        if (idxErr || !idxStats.isFile()) {
          serveFile(res, path.join(__dirname, 'index.html'));
          return;
        }
        serveFile(res, indexPath);
      });
      return;
    }
    serveFile(res, filePath);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GolBody server running on http://0.0.0.0:${PORT} (base: ${BASE_PATH})`);
});
