import { type Request, type Response } from "express";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = process.env["STRIPE_SECRET_KEY"] ? new Stripe(process.env["STRIPE_SECRET_KEY"], { apiVersion: "2025-06-30.basil" as any }) : null;
const supabase = createClient(process.env["SUPABASE_URL"] || "https://quvqqxrfewrsbajsllzk.supabase.co", process.env["SUPABASE_SERVICE_ROLE_KEY"] || "");
const WEBHOOK_SECRET = process.env["STRIPE_WEBHOOK_SECRET"] || "";

const PRICES: Record<string, { plan: string; credits: number }> = {
  "price_1Tqx3UAa7KFR9IQxMYKKKo0R": { plan: "starter", credits: 1000 },
  "price_1Tqx6OAa7KFR9IQxuDzFeUp8": { plan: "starter", credits: 1000 },
  "price_1Tqx46Aa7KFR9IQxqmcnnpxZ": { plan: "pro", credits: 3000 },
  "price_1Tqx72Aa7KFR9IQxWyTp9s0H": { plan: "pro", credits: 3000 },
  "price_1Tqx4LAa7KFR9IQx6VwgnQ6Z": { plan: "ultra", credits: 7500 },
  "price_1Tqx84Aa7KFR9IQxAZ6WU7mo": { plan: "ultra", credits: 7500 },
};

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  if (!stripe || !WEBHOOK_SECRET) { res.status(400).send("Stripe not configured"); return; }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, req.headers["stripe-signature"] as string, WEBHOOK_SECRET);
  } catch (err: any) { res.status(400).send(`Webhook Error: ${err.message}`); return; }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.metadata?.user_id;
      const pack = s.metadata?.pack;
      const credits = parseInt(s.metadata?.credits ?? "0", 10);
      if (userId && s.customer) await supabase.from("profiles").update({ stripe_customer_id: s.customer as string }).eq("id", userId);
      if (pack && credits && userId) {
        const { data: p } = await supabase.from("profiles").select("credits").eq("id", userId).single();
        await supabase.from("profiles").update({ credits: ((p?.credits as number) || 0) + credits }).eq("id", userId);
      }
    } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      const priceId = sub.items?.data?.[0]?.price?.id ?? "";
      const { plan, credits } = PRICES[priceId] ?? { plan: "free", credits: 200 };
      if (sub.status === "active" || sub.status === "trialing") {
        const cust = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
        let { data: profiles } = await supabase.from("profiles").select("id").eq("stripe_customer_id", sub.customer as string);
        if (!profiles?.length) { const r = await supabase.from("profiles").select("id").eq("email", cust.email); profiles = r.data; }
        for (const p of profiles ?? []) {
          await supabase.from("profiles").update({ plan, stripe_customer_id: sub.customer as string, stripe_subscription_id: sub.id, credits, credits_reset_date: new Date().toISOString().split("T")[0] }).eq("id", p.id);
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const { data: profiles } = await supabase.from("profiles").select("id").eq("stripe_customer_id", sub.customer as string);
      for (const p of profiles ?? []) await supabase.from("profiles").update({ plan: "free", stripe_subscription_id: null, credits: 200, credits_reset_date: null }).eq("id", p.id);
    } else if (event.type === "invoice.paid") {
      const inv = event.data.object as Stripe.Invoice;
      const subId = (inv as any).subscription as string | null;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        const priceId = sub.items?.data?.[0]?.price?.id ?? "";
        const { plan, credits } = PRICES[priceId] ?? { plan: "free", credits: 200 };
        const { data: profiles } = await supabase.from("profiles").select("id").eq("stripe_customer_id", inv.customer as string);
        for (const p of profiles ?? []) await supabase.from("profiles").update({ plan, credits, credits_reset_date: new Date().toISOString().split("T")[0] }).eq("id", p.id);
      }
    }
  } catch (err) { console.error("Webhook error:", err); }
  res.json({ received: true });
}
