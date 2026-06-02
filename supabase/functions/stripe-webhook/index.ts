import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-04-10",
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (e) {
    return new Response(`Webhook signature verification failed: ${e.message}`, { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Update subscription row by Stripe customer ID.
  const patchByCustomer = async (customerId: string, patch: Record<string, unknown>) => {
    const { data } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (!data?.user_id) return;
    await supabase
      .from("subscriptions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("user_id", data.user_id);
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.CheckoutSession;
      if (session.mode !== "subscription" || !session.subscription) break;
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      const interval = sub.items.data[0]?.price?.recurring?.interval;
      await patchByCustomer(session.customer as string, {
        stripe_subscription_id: sub.id,
        status: "active",
        plan: interval === "year" ? "yearly" : "monthly",
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      });
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const active = sub.status === "active" || sub.status === "trialing";
      await patchByCustomer(sub.customer as string, {
        stripe_subscription_id: sub.id,
        status: active ? sub.status : sub.status, // preserve trialing/past_due as-is
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      });
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await patchByCustomer(sub.customer as string, {
        status: "canceled",
        current_period_end: null,
      });
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.customer) {
        await patchByCustomer(invoice.customer as string, { status: "past_due" });
      }
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
