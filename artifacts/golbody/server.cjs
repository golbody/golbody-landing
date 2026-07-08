const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '/';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Hardcoded Stripe Price IDs
const STRIPE_PRICE_STARTER = 'price_1TqduWAa7KFR9IQxxxu5V4Zs';
const STRIPE_PRICE_PRO = 'price_1TqdupAa7KFR9IQxIvFx3Qno';
const STRIPE_PRICE_ULTRA = 'price_1Tqdv7Aa7KFR9IQxC1TG0vNv';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://quvqqxrfewrsbajsllzk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dnFxeHJmZXdyc2JhanNsbHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY4NzUzMzUsImV4cCI6MjA2MjQ1MTMzNX0.kSiwUpjHFE3wV6vJmCbYmMNv291rEW1SPgkWIO5W6G4';

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-06-30.basil' }) : null;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

const PRICE_MAP = {
  starter: STRIPE_PRICE_STARTER,
  pro: STRIPE_PRICE_PRO,
  ultra: STRIPE_PRICE_ULTRA,
};

const PLAN_CREDITS = {
  free: 100,
  starter: 1000,
  pro: 3000,
  ultra: 7500,
};

const app = express();

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
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const status = subscription.status;

        // Find plan by price ID
        let plan = 'free';
        let credits = 100;
        if (priceId === STRIPE_PRICE_STARTER) { plan = 'starter'; credits = 1000; }
        else if (priceId === STRIPE_PRICE_PRO) { plan = 'pro'; credits = 3000; }
        else if (priceId === STRIPE_PRICE_ULTRA) { plan = 'ultra'; credits = 7500; }

        if (status === 'active' || status === 'trialing') {
          // Update profile
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_customer_id', customerId);

          if (profiles && profiles.length > 0) {
            for (const p of profiles) {
              await supabase.from('profiles').update({
                plan: plan,
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
              credits: 100,
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
        let credits = 100;
        let plan = 'free';
        if (priceId === STRIPE_PRICE_STARTER) { plan = 'starter'; credits = 1000; }
        else if (priceId === STRIPE_PRICE_PRO) { plan = 'pro'; credits = 3000; }
        else if (priceId === STRIPE_PRICE_ULTRA) { plan = 'ultra'; credits = 7500; }

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

// Create checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const { plan, customerEmail, userId } = req.body;
    const priceId = PRICE_MAP[plan];
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Get or create Stripe customer
    let customerId = null;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profiles && profiles.stripe_customer_id) {
      customerId = profiles.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: customerEmail,
        metadata: { userId },
      });
      customerId = customer.id;
      await supabase.from('profiles').update({
        stripe_customer_id: customerId,
      }).eq('id', userId);
    }

    const origin = req.headers.origin || req.headers.referer || `https://${process.env.REPLIT_DEV_DOMAIN || 'golbody.com'}`;
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}${BASE_PATH}dashboard.html?success=true`,
      cancel_url: `${origin}${BASE_PATH}dashboard.html?canceled=true`,
      metadata: { userId, plan },
    });

    res.json({ url: session.url });
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
