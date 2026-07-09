import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const router = Router();
const STRIPE_SECRET_KEY = process.env["STRIPE_SECRET_KEY"] || "";
const SUPABASE_URL = process.env["SUPABASE_URL"] || "https://quvqqxrfewrsbajsllzk.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-06-30.basil" as any }) : null;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PRICE_MAP: Record<string, Record<string, string>> = {
  starter: { monthly: "price_1Tqx3UAa7KFR9IQxMYKKKo0R", yearly: "price_1Tqx6OAa7KFR9IQxuDzFeUp8" },
  pro:     { monthly: "price_1Tqx46Aa7KFR9IQxqmcnnpxZ", yearly: "price_1Tqx72Aa7KFR9IQxWyTp9s0H" },
  ultra:   { monthly: "price_1Tqx4LAa7KFR9IQx6VwgnQ6Z", yearly: "price_1Tqx84Aa7KFR9IQxAZ6WU7mo" },
};
const CREDIT_PACKS: Record<string, { amount: number; credits: number; name: string }> = {
  small: { amount: 490, credits: 500, name: "Pack Legere" },
  large: { amount: 1490, credits: 1500, name: "Pack Max" },
};

router.post("/create-checkout-session", async (req: Request, res: Response) => {
  try {
    if (!stripe) return void res.status(500).json({ error: "Stripe not configured" });
    const { plan, billing, pack, customerEmail, user_id } = req.body as any;
    const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", user_id).single();
    let customerId: string;
    if (profile?.stripe_customer_id) {
      customerId = profile.stripe_customer_id as string;
    } else {
      const c = await stripe.customers.create({ email: customerEmail, metadata: { user_id } });
      customerId = c.id;
      await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user_id);
    }
    const origin = (req.headers.origin as string) || "https://golbody.com";
    if (plan) {
      const priceId = PRICE_MAP[plan]?.[billing || "monthly"] ?? PRICE_MAP[plan]?.["monthly"];
      if (!priceId) return void res.status(400).json({ error: "Invalid plan" });
      const session = await stripe.checkout.sessions.create({
        customer: customerId, mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/dashboard.html?success=true`,
        cancel_url: `${origin}/dashboard.html?canceled=true`,
        metadata: { user_id, plan, billing: billing || "monthly" },
      });
      return void res.json({ url: session.url });
    }
    if (pack) {
      const pd = CREDIT_PACKS[pack];
      if (!pd) return void res.status(400).json({ error: "Invalid pack" });
      const session = await stripe.checkout.sessions.create({
        customer: customerId, mode: "payment",
        line_items: [{ price_data: { currency: "eur", product_data: { name: pd.name }, unit_amount: pd.amount }, quantity: 1 }],
        success_url: `${origin}/dashboard.html?success=true`,
        cancel_url: `${origin}/dashboard.html?canceled=true`,
        metadata: { user_id, pack, credits: String(pd.credits) },
      });
      return void res.json({ url: session.url });
    }
    res.status(400).json({ error: "Missing plan or pack" });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/use-credit", async (req: Request, res: Response) => {
  try {
    const { userId } = req.body as any;
    if (!userId) return void res.status(400).json({ error: "Missing userId" });
    const { data: profile, error } = await supabase.from("profiles").select("credits,plan").eq("id", userId).single();
    if (error || !profile) return void res.status(404).json({ error: "Profile not found" });
    if ((profile.credits as number) < 100) return void res.status(402).json({ error: "Credits insuffisants", credits: profile.credits });
    const newCredits = (profile.credits as number) - 100;
    await supabase.from("profiles").update({ credits: newCredits }).eq("id", userId);
    res.json({ success: true, credits: newCredits });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/create-portal-session", async (req: Request, res: Response) => {
  try {
    if (!stripe) return void res.status(500).json({ error: "Stripe not configured" });
    const { user_id } = req.body as any;
    if (!user_id) return void res.status(400).json({ error: "Missing user_id" });
    const { data: profile, error } = await supabase.from("profiles").select("stripe_customer_id").eq("id", user_id).single();
    if (error || !profile?.stripe_customer_id) return void res.status(404).json({ error: "No Stripe customer" });
    const origin = (req.headers.origin as string) || "https://golbody.com";
    const session = await stripe.billingPortal.sessions.create({ customer: profile.stripe_customer_id as string, return_url: `${origin}/dashboard.html` });
    res.json({ url: session.url });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/profile/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { data: profile, error } = await supabase.from("profiles").select("credits,plan,stripe_customer_id,stripe_subscription_id,credits_reset_date").eq("id", userId).single();
    if (error || !profile) return void res.status(404).json({ error: "Profile not found" });
    res.json(profile);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
