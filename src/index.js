import { Hono } from "hono";

const app = new Hono();

// ---------- helpers ----------

const PLAID_HOSTS = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

function plaidHost(env) {
  return PLAID_HOSTS[env.PLAID_ENV || "sandbox"];
}

async function plaid(env, path, body) {
  const res = await fetch(plaidHost(env) + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      ...body,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Plaid error", path, JSON.stringify(data));
    throw new Error(data.error_message || "Plaid request failed");
  }
  return data;
}

// ---------- auth ----------
// Simple shared-password auth: fine for a personal app.
// Every /api route except the Plaid webhook requires the header.

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/plaid_webhook") return next();
  const key = c.req.header("x-app-key");
  if (!key || key !== c.env.APP_PASSWORD) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

// ---------- Plaid Link flow ----------

app.post("/api/create_link_token", async (c) => {
  const origin = new URL(c.req.url).origin;
  const data = await plaid(c.env, "/link/token/create", {
    user: { client_user_id: "primary-user" },
    client_name: "Ledger",
    products: ["transactions"],
    country_codes: ["US"],
    language: "en",
    webhook: origin + "/api/plaid_webhook",
  });
  return c.json({ link_token: data.link_token });
});

app.post("/api/exchange_public_token", async (c) => {
  const { public_token, institution_name } = await c.req.json();
  const data = await plaid(c.env, "/item/public_token/exchange", {
    public_token,
  });
  await c.env.DB.prepare(
    "INSERT INTO items (item_id, access_token, institution_name) VALUES (?, ?, ?)"
  )
    .bind(data.item_id, data.access_token, institution_name || "Bank")
    .run();
  // Pull whatever is available right away.
  await syncItem(c.env, data.item_id);
  return c.json({ ok: true });
});

// ---------- webhook ----------

app.post("/api/plaid_webhook", async (c) => {
  const body = await c.req.json();
  console.log("Webhook:", body.webhook_type, body.webhook_code, body.item_id);
  if (
    body.webhook_type === "TRANSACTIONS" &&
    ["SYNC_UPDATES_AVAILABLE", "INITIAL_UPDATE", "DEFAULT_UPDATE"].includes(
      body.webhook_code
    )
  ) {
    const added = await syncItem(c.env, body.item_id);
    // TODO (session 3): send a web push notification here for each
    // uncategorized transaction that was just added.
    console.log(`Synced ${added} new transactions`);
  }
  return c.json({ ok: true });
});

// ---------- sync ----------

async function syncItem(env, itemId) {
  const item = await env.DB.prepare(
    "SELECT access_token, sync_cursor FROM items WHERE item_id = ?"
  )
    .bind(itemId)
    .first();
  if (!item) return 0;

  const rules = (
    await env.DB.prepare("SELECT pattern, category FROM rules").all()
  ).results;

  let cursor = item.sync_cursor || undefined;
  let hasMore = true;
  let addedCount = 0;

  while (hasMore) {
    const data = await plaid(env, "/transactions/sync", {
      access_token: item.access_token,
      cursor,
    });

    const stmts = [];
    for (const t of data.added) {
      const merchant = t.merchant_name || t.name || "";
      const auto = autoCategory(rules, merchant);
      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO transactions
           (tx_id, item_id, account_id, date, merchant, amount, category, categorized_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          t.transaction_id,
          itemId,
          t.account_id,
          t.date,
          merchant,
          t.amount,
          auto,
          auto ? "rule" : null
        )
      );
      addedCount++;
    }
    for (const t of data.modified) {
      stmts.push(
        env.DB.prepare(
          "UPDATE transactions SET date = ?, merchant = ?, amount = ? WHERE tx_id = ?"
        ).bind(t.date, t.merchant_name || t.name || "", t.amount, t.transaction_id)
      );
    }
    for (const t of data.removed) {
      stmts.push(
        env.DB.prepare("DELETE FROM transactions WHERE tx_id = ?").bind(
          t.transaction_id
        )
      );
    }
    if (stmts.length) await env.DB.batch(stmts);

    cursor = data.next_cursor;
    hasMore = data.has_more;
  }

  await env.DB.prepare("UPDATE items SET sync_cursor = ? WHERE item_id = ?")
    .bind(cursor, itemId)
    .run();
  return addedCount;
}

function autoCategory(rules, merchant) {
  const m = merchant.toLowerCase();
  for (const r of rules) {
    if (m.includes(r.pattern.toLowerCase())) return r.category;
  }
  return null;
}

// ---------- app API ----------

app.get("/api/transactions", async (c) => {
  const status = c.req.query("status"); // "uncategorized" | undefined
  const month = c.req.query("month"); // "2026-08" | undefined
  const category = c.req.query("category"); // exact category name | undefined
  const where = [];
  const binds = [];
  if (status === "uncategorized") where.push("category IS NULL");
  if (month) {
    where.push("date LIKE ?");
    binds.push(month + "%");
  }
  if (category) {
    where.push("category = ?");
    binds.push(category);
  }
  const rows = await c.env.DB.prepare(
    `SELECT tx_id, date, merchant, amount, category, categorized_by
     FROM transactions ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY date DESC, tx_id LIMIT 300`
  )
    .bind(...binds)
    .all();
  return c.json(rows.results);
});

app.post("/api/transactions/:id/category", async (c) => {
  const { category, save_rule } = await c.req.json();
  const txId = c.req.param("id");
  await c.env.DB.prepare(
    "UPDATE transactions SET category = ?, categorized_by = 'you' WHERE tx_id = ?"
  )
    .bind(category, txId)
    .run();
  if (save_rule) {
    const tx = await c.env.DB.prepare(
      "SELECT merchant FROM transactions WHERE tx_id = ?"
    )
      .bind(txId)
      .first();
    if (tx?.merchant) {
      await c.env.DB.prepare(
        "INSERT INTO rules (pattern, category) VALUES (?, ?)"
      )
        .bind(tx.merchant, category)
        .run();
    }
  }
  return c.json({ ok: true });
});

app.get("/api/categories", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT name, kind FROM categories ORDER BY sort_order"
  ).all();
  return c.json(rows.results);
});

app.get("/api/summary", async (c) => {
  const month = c.req.query("month"); // "2026-08"
  const rows = await c.env.DB.prepare(
    `SELECT category, SUM(amount) AS total, COUNT(*) AS n
     FROM transactions
     WHERE date LIKE ? AND category IS NOT NULL
     GROUP BY category ORDER BY total DESC`
  )
    .bind((month || new Date().toISOString().slice(0, 7)) + "%")
    .all();
  return c.json(rows.results);
});

// ---------- budgets ----------

app.get("/api/budgets", async (c) => {
  const month = c.req.query("month") || new Date().toISOString().slice(0, 7);
  const rows = await c.env.DB.prepare(
    "SELECT category, amount FROM budgets WHERE month = ?"
  )
    .bind(month)
    .all();
  return c.json(rows.results);
});

// Bulk upsert: { month, budgets: [{ category, amount }] }
// amount <= 0 removes the budget for that category.
app.post("/api/budgets", async (c) => {
  const { month, budgets } = await c.req.json();
  if (!month || !Array.isArray(budgets)) {
    return c.json({ error: "month and budgets[] required" }, 400);
  }
  const stmts = [];
  for (const b of budgets) {
    if (!b.category) continue;
    const amount = Number(b.amount) || 0;
    if (amount <= 0) {
      stmts.push(
        c.env.DB.prepare(
          "DELETE FROM budgets WHERE category = ? AND month = ?"
        ).bind(b.category, month)
      );
    } else {
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO budgets (category, month, amount) VALUES (?, ?, ?)
           ON CONFLICT (category, month) DO UPDATE SET amount = excluded.amount`
        ).bind(b.category, month, amount)
      );
    }
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// Copy budgets into `to` from the most recent earlier month that has any.
app.post("/api/budgets/copy", async (c) => {
  const { to } = await c.req.json();
  if (!to) return c.json({ error: "to required" }, 400);
  const src = await c.env.DB.prepare(
    "SELECT MAX(month) AS m FROM budgets WHERE month < ?"
  )
    .bind(to)
    .first();
  if (!src?.m) return c.json({ ok: false, copied: 0 });
  const r = await c.env.DB.prepare(
    `INSERT INTO budgets (category, month, amount)
     SELECT category, ?, amount FROM budgets WHERE month = ?
     ON CONFLICT (category, month) DO UPDATE SET amount = excluded.amount`
  )
    .bind(to, src.m)
    .run();
  return c.json({ ok: true, from: src.m });
});

// Everything the home screens need in one call.
app.get("/api/overview", async (c) => {
  const month = c.req.query("month") || new Date().toISOString().slice(0, 7);
  const [categories, budgets, spent, uncat] = await Promise.all([
    c.env.DB.prepare(
      "SELECT name, kind FROM categories ORDER BY sort_order"
    ).all(),
    c.env.DB.prepare("SELECT category, amount FROM budgets WHERE month = ?")
      .bind(month)
      .all(),
    c.env.DB.prepare(
      `SELECT category, SUM(amount) AS total, COUNT(*) AS n
       FROM transactions
       WHERE date LIKE ? AND category IS NOT NULL
       GROUP BY category`
    )
      .bind(month + "%")
      .all(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE category IS NULL"
    ).first(),
  ]);
  return c.json({
    month,
    categories: categories.results,
    budgets: budgets.results,
    spent: spent.results,
    uncategorized: uncat?.n || 0,
  });
});

// Point every connected bank's webhook at this deployment's URL.
// Needed once after the worker URL changes (rename, custom domain).
app.post("/api/update_webhooks", async (c) => {
  const origin = new URL(c.req.url).origin;
  const items = (
    await c.env.DB.prepare("SELECT item_id, access_token FROM items").all()
  ).results;
  for (const it of items) {
    await plaid(c.env, "/item/webhook/update", {
      access_token: it.access_token,
      webhook: origin + "/api/plaid_webhook",
    });
  }
  return c.json({ ok: true, updated: items.length });
});

app.post("/api/sync_now", async (c) => {
  const items = (
    await c.env.DB.prepare("SELECT item_id FROM items").all()
  ).results;
  let added = 0;
  for (const it of items) added += await syncItem(c.env, it.item_id);
  return c.json({ added });
});

export default app;
