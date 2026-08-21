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

// ---------- months ----------

function todayMonth() {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonthStr(m, delta) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// The latest month allowed to view/edit: today's real month, or a later
// month if one has been explicitly set up via /api/months/next.
async function latestMonth(env) {
  const cur = todayMonth();
  const row = await env.DB.prepare("SELECT MAX(month) AS m FROM months").first();
  return row?.m && row.m > cur ? row.m : cur;
}

// ---------- app API ----------

app.get("/api/transactions", async (c) => {
  const status = c.req.query("status"); // "uncategorized" | undefined
  const month = c.req.query("month"); // "2026-08" | undefined
  const category = c.req.query("category"); // exact category name | undefined

  // Category-scoped listing: whole transactions filed straight to this
  // category, plus each split line-item that lands in this category
  // (shown with just its own portion, not the parent's full amount).
  if (category) {
    const whereWhole = ["category = ?"];
    const bindsWhole = [category];
    if (month) {
      whereWhole.push("date LIKE ?");
      bindsWhole.push(month + "%");
    }
    const whereSplit = ["s.category = ?"];
    const bindsSplit = [category];
    if (month) {
      whereSplit.push("t.date LIKE ?");
      bindsSplit.push(month + "%");
    }
    const [whole, splitRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT tx_id, date, merchant, amount, category, categorized_by, NULL AS split_id, NULL AS description
         FROM transactions WHERE ${whereWhole.join(" AND ")}`
      )
        .bind(...bindsWhole)
        .all(),
      c.env.DB.prepare(
        `SELECT t.tx_id AS tx_id, t.date AS date, t.merchant AS merchant, s.amount AS amount,
                s.category AS category, 'split' AS categorized_by, s.id AS split_id, s.description AS description
         FROM splits s JOIN transactions t ON t.tx_id = s.tx_id
         WHERE ${whereSplit.join(" AND ")}`
      )
        .bind(...bindsSplit)
        .all(),
    ]);
    const combined = [...whole.results, ...splitRows.results]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 300);
    return c.json(combined);
  }

  const where = [];
  const binds = [];
  if (status === "uncategorized") {
    where.push("category IS NULL");
    where.push("categorized_by IS NULL");
  }
  if (month) {
    where.push("date LIKE ?");
    binds.push(month + "%");
  }
  const rows = await c.env.DB.prepare(
    `SELECT tx_id, date, merchant, amount, category, categorized_by
     FROM transactions ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY date DESC, tx_id LIMIT 300`
  )
    .bind(...binds)
    .all();

  // Attach each split-filed transaction's breakdown so the UI can show
  // "Split · N ways" instead of a blank category.
  const splitTxIds = rows.results.filter((t) => t.categorized_by === "split").map((t) => t.tx_id);
  if (splitTxIds.length) {
    const placeholders = splitTxIds.map(() => "?").join(",");
    const splitsForIds = await c.env.DB.prepare(
      `SELECT tx_id, category, amount, description FROM splits WHERE tx_id IN (${placeholders})`
    )
      .bind(...splitTxIds)
      .all();
    const byTx = {};
    for (const s of splitsForIds.results) (byTx[s.tx_id] ||= []).push(s);
    for (const t of rows.results) if (byTx[t.tx_id]) t.splits = byTx[t.tx_id];
  }

  return c.json(rows.results);
});

// Fetch a transaction plus its splits (if any), for the split editor.
app.get("/api/transactions/:id/splits", async (c) => {
  const txId = c.req.param("id");
  const [tx, splits] = await Promise.all([
    c.env.DB.prepare("SELECT tx_id, date, merchant, amount FROM transactions WHERE tx_id = ?")
      .bind(txId)
      .first(),
    c.env.DB.prepare("SELECT id, amount, description, category FROM splits WHERE tx_id = ? ORDER BY id")
      .bind(txId)
      .all(),
  ]);
  if (!tx) return c.json({ error: "not found" }, 404);
  return c.json({ tx, splits: splits.results });
});

// Replace a transaction's splits. { splits: [{ amount, description, category }] }
// An empty array clears any split and returns the transaction to uncategorized.
app.post("/api/transactions/:id/splits", async (c) => {
  const txId = c.req.param("id");
  const { splits } = await c.req.json();
  if (!Array.isArray(splits)) return c.json({ error: "splits[] required" }, 400);
  const clean = splits.filter((s) => s.category && Number(s.amount));
  const stmts = [c.env.DB.prepare("DELETE FROM splits WHERE tx_id = ?").bind(txId)];
  for (const s of clean) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO splits (tx_id, amount, description, category) VALUES (?, ?, ?, ?)"
      ).bind(txId, Number(s.amount), s.description || null, s.category)
    );
  }
  stmts.push(
    c.env.DB.prepare("UPDATE transactions SET category = NULL, categorized_by = ? WHERE tx_id = ?").bind(
      clean.length ? "split" : null,
      txId
    )
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

app.post("/api/transactions/:id/category", async (c) => {
  const { category, save_rule } = await c.req.json();
  const txId = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE transactions SET category = ?, categorized_by = 'you' WHERE tx_id = ?"
    ).bind(category, txId),
    c.env.DB.prepare("DELETE FROM splits WHERE tx_id = ?").bind(txId),
  ]);
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

const KINDS = ["expense", "income", "transfer"];

// Create a new budget (category). { name, kind }
app.post("/api/categories", async (c) => {
  const { name, kind } = await c.req.json();
  if (!name?.trim() || !KINDS.includes(kind)) {
    return c.json({ error: "name and a valid kind are required" }, 400);
  }
  const existing = await c.env.DB.prepare(
    "SELECT 1 FROM categories WHERE name = ?"
  )
    .bind(name.trim())
    .first();
  if (existing) return c.json({ error: "a budget with that name already exists" }, 409);
  const maxSort = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories"
  ).first();
  await c.env.DB.prepare(
    "INSERT INTO categories (name, kind, sort_order) VALUES (?, ?, ?)"
  )
    .bind(name.trim(), kind, (maxSort?.m || 0) + 1)
    .run();
  return c.json({ ok: true });
});

// Rename and/or re-type a budget. { name?, kind? }
app.put("/api/categories/:name", async (c) => {
  const oldName = c.req.param("name");
  const { name, kind } = await c.req.json();
  const newName = name?.trim() || oldName;
  if (kind && !KINDS.includes(kind)) {
    return c.json({ error: "invalid kind" }, 400);
  }
  const existing = await c.env.DB.prepare(
    "SELECT kind FROM categories WHERE name = ?"
  )
    .bind(oldName)
    .first();
  if (!existing) return c.json({ error: "not found" }, 404);
  if (newName !== oldName) {
    const clash = await c.env.DB.prepare(
      "SELECT 1 FROM categories WHERE name = ?"
    )
      .bind(newName)
      .first();
    if (clash) return c.json({ error: "a budget with that name already exists" }, 409);
  }
  const finalKind = kind || existing.kind;
  const stmts = [
    c.env.DB.prepare("UPDATE categories SET name = ?, kind = ? WHERE name = ?").bind(
      newName,
      finalKind,
      oldName
    ),
  ];
  if (newName !== oldName) {
    stmts.push(
      c.env.DB.prepare("UPDATE budgets SET category = ? WHERE category = ?").bind(
        newName,
        oldName
      )
    );
    stmts.push(
      c.env.DB.prepare(
        "UPDATE transactions SET category = ? WHERE category = ?"
      ).bind(newName, oldName)
    );
    stmts.push(
      c.env.DB.prepare("UPDATE rules SET category = ? WHERE category = ?").bind(
        newName,
        oldName
      )
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// Delete a budget. Existing transactions/rules keep the old category name.
app.delete("/api/categories/:name", async (c) => {
  const name = c.req.param("name");
  await c.env.DB.prepare("DELETE FROM categories WHERE name = ?").bind(name).run();
  return c.json({ ok: true });
});

// Category totals for a month, combining plainly-categorized transactions
// with each split's own portion of a split transaction.
async function spentByCategory(env, month) {
  const rows = await env.DB.prepare(
    `SELECT category, SUM(amount) AS total, COUNT(*) AS n FROM (
       SELECT category, amount FROM transactions WHERE date LIKE ? AND category IS NOT NULL
       UNION ALL
       SELECT s.category AS category, s.amount AS amount
       FROM splits s JOIN transactions t ON t.tx_id = s.tx_id
       WHERE t.date LIKE ?
     )
     GROUP BY category ORDER BY total DESC`
  )
    .bind(month + "%", month + "%")
    .all();
  return rows.results;
}

app.get("/api/summary", async (c) => {
  const month = c.req.query("month") || todayMonth(); // "2026-08"
  const rows = await spentByCategory(c.env, month);
  return c.json(rows);
});

// ---------- budgets ----------

app.get("/api/budgets", async (c) => {
  const month = c.req.query("month") || todayMonth();
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
  const month = c.req.query("month") || todayMonth();
  const [categories, budgets, spent, uncat, latest] = await Promise.all([
    c.env.DB.prepare(
      "SELECT name, kind FROM categories ORDER BY sort_order"
    ).all(),
    c.env.DB.prepare("SELECT category, amount FROM budgets WHERE month = ?")
      .bind(month)
      .all(),
    spentByCategory(c.env, month),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE category IS NULL AND categorized_by IS NULL"
    ).first(),
    latestMonth(c.env),
  ]);
  return c.json({
    month,
    categories: categories.results,
    budgets: budgets.results,
    spent,
    uncategorized: uncat?.n || 0,
    latest_month: latest,
  });
});

// Create and move into the next month, capped to one past the real
// calendar month at a time. { copy: boolean } copies budgets forward
// from the current latest month, same as /api/budgets/copy.
app.post("/api/months/next", async (c) => {
  const { copy } = await c.req.json().catch(() => ({}));
  const latest = await latestMonth(c.env);
  const next = shiftMonthStr(latest, 1);
  await c.env.DB.prepare("INSERT OR IGNORE INTO months (month) VALUES (?)")
    .bind(next)
    .run();
  if (copy) {
    await c.env.DB.prepare(
      `INSERT INTO budgets (category, month, amount)
       SELECT category, ?, amount FROM budgets WHERE month = ?
       ON CONFLICT (category, month) DO UPDATE SET amount = excluded.amount`
    )
      .bind(next, latest)
      .run();
  }
  return c.json({ ok: true, month: next });
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
