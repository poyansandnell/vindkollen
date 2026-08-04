/**
 * Push-notis-rutter.
 *
 * GET  /push/vapid-public-key   — returnerar VAPID public key (frontend behöver den för subscribe)
 * POST /push/subscribe          — sparar/uppdaterar en push-prenumeration
 * DELETE /push/subscribe        — tar bort en prenumeration
 * POST /push/send               — skickar notis till alla prenumeranter (kräver PUSH_ADMIN_SECRET)
 */

import { Router, type IRouter } from "express";
import webpush from "web-push";
import { db } from "../lib/db";
import { pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Konfigurera VAPID vid uppstart om nycklarna finns.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:vindkollen@example.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

const router: IRouter = Router();

/** VAPID public key — behövs av frontenden för att anropa subscribe(). */
router.get("/push/vapid-public-key", (_req, res) => {
  if (!VAPID_PUBLIC) return res.status(503).json({ error: "Push-notiser är inte konfigurerade." });
  res.json({ publicKey: VAPID_PUBLIC });
});

/** Spara eller uppdatera en prenumeration. */
router.post("/push/subscribe", async (req, res) => {
  const { endpoint, keys } = req.body as {
    endpoint?: string;
    keys?: { p256dh: string; auth: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: "Ogiltig prenumeration (saknar endpoint eller nycklar)." });
  }

  try {
    await db
      .insert(pushSubscriptionsTable)
      .values({
        endpoint,
        keys,
        userAgent: req.headers["user-agent"] ?? null,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: { keys, lastSeenAt: new Date() },
      });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Kunde inte spara prenumeration." });
  }
});

/** Ta bort en prenumeration (t.ex. om användaren väljer att avprenumerera). */
router.delete("/push/subscribe", async (req, res) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) return res.status(400).json({ error: "Saknar endpoint." });

  await db
    .delete(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));

  res.json({ ok: true });
});

/** Skicka notis till alla prenumeranter. Kräver rätt PUSH_ADMIN_SECRET i x-admin-secret-headern. */
router.post("/push/send", async (req, res) => {
  const adminSecret = process.env.PUSH_ADMIN_SECRET;
  if (!adminSecret) return res.status(503).json({ error: "Push-admin är inte konfigurerat." });
  if (req.headers["x-admin-secret"] !== adminSecret) {
    return res.status(401).json({ error: "Fel lösenord." });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(503).json({ error: "VAPID-nycklar saknas — kan inte skicka." });
  }

  const { title, body, url } = req.body as {
    title?: string;
    body?: string;
    url?: string;
  };
  if (!title || !body) return res.status(400).json({ error: "title och body krävs." });

  const subs = await db.select().from(pushSubscriptionsTable);
  const payload = JSON.stringify({ title, body, url: url ?? "/" });

  let sent = 0, failed = 0, removed = 0;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys as { p256dh: string; auth: string },
          },
          payload,
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 410 || status === 404) {
          // Prenumeration utgången — rensa bort den.
          await db
            .delete(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
          removed++;
        } else {
          failed++;
        }
      }
    }),
  );

  res.json({ ok: true, total: subs.length, sent, failed, removed });
});

export default router;
