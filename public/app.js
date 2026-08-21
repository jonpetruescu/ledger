// Ledger — front end. Two layouts (classic / envelopes), switchable in Settings.

let KEY = localStorage.getItem("appKey") || "";
let MODE = localStorage.getItem("layoutMode") || "classic"; // "classic" | "envelopes"
let MONTH = new Date().toISOString().slice(0, 7);
let LATEST_MONTH = MONTH; // furthest month you're allowed to view; refreshed from /overview
let ROUTE = null; // {name, arg}

const $ = (id) => document.getElementById(id);
const view = () => $("view");

// ---------- api ----------

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-key": KEY,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("appKey");
    showLogin("Wrong password — try again.");
    throw new Error("unauthorized");
  }
  return res.json();
}

function showLogin(msg = "") {
  $("pwErr").textContent = msg;
  const d = $("login");
  if (!d.open) d.showModal();
}

$("pwGo").onclick = async () => {
  const val = $("pw").value.trim();
  if (!val) {
    $("pwErr").textContent = "Enter a password first";
    return;
  }
  KEY = val;
  localStorage.setItem("appKey", KEY);
  $("login").close();
  go(defaultRoute());
};

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(m) {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${y}`;
}
function shiftMonth(m, delta) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtDay(dateStr) {
  const [, mo, day] = dateStr.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${day}`;
}
// Plaid convention: positive = money out.
function fmtAmt(a) {
  const abs = Math.abs(a).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return a < 0 ? "+" + abs : abs;
}
function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

function daysInfo() {
  const now = new Date();
  const cur = now.toISOString().slice(0, 7);
  if (MONTH !== cur) return null;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { day: now.getDate(), dim, left: dim - now.getDate() };
}

async function getOverview() {
  const ov = await api("/overview?month=" + MONTH);
  if (ov.latest_month) {
    LATEST_MONTH = ov.latest_month;
    updateMonthNav();
  }
  return ov;
}

function derive(ov) {
  const budget = {};
  for (const b of ov.budgets) budget[b.category] = b.amount;
  const spent = {};
  for (const s of ov.spent) spent[s.category] = s.total;
  const expense = ov.categories.filter((c) => c.kind === "expense");
  const income = ov.categories.filter((c) => c.kind === "income");
  const transfer = ov.categories.filter((c) => c.kind === "transfer");
  let totBudget = 0, totSpent = 0, incBudget = 0, incSoFar = 0;
  for (const c of expense) {
    totBudget += budget[c.name] || 0;
    totSpent += Math.max(0, spent[c.name] || 0);
  }
  for (const c of income) {
    incBudget += budget[c.name] || 0;
    incSoFar += -(spent[c.name] || 0);
  }
  return { budget, spent, expense, income, transfer, totBudget, totSpent, incBudget, incSoFar };
}

// ---------- shared components ----------

const ICONS = {
  list: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  bars: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  sliders: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 8h16M4 16h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="15" cy="16" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  envelope: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 7h16v12H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M8 12.5l2.6 2.6L16 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function tabbar() {
  const nav = $("tabbar");
  const tabs =
    MODE === "classic"
      ? [
          ["tx", "Transactions", ICONS.list],
          ["budget", "Budget", ICONS.bars],
          ["plan", "Plan", ICONS.sliders],
        ]
      : [
          ["env", "Envelopes", ICONS.envelope],
          ["activity", "Activity", ICONS.list],
        ];
  nav.innerHTML = "";
  for (const [name, label, icon] of tabs) {
    const b = document.createElement("button");
    b.className = ROUTE && ROUTE.name === name ? "on" : "";
    b.innerHTML = icon + `<span>${label}</span>`;
    b.onclick = () => go({ name });
    nav.appendChild(b);
  }
}

const KIND_LABEL = { expense: "Expense", income: "Income", transfer: "Transfer" };

// A category <select>, grouped by kind. onPick(name) fires on change.
function categorySelect(cats, onPick, selected) {
  const sel = document.createElement("select");
  sel.className = "catselect";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a category…";
  placeholder.disabled = true;
  placeholder.selected = !selected;
  sel.appendChild(placeholder);
  for (const kind of ["expense", "income", "transfer"]) {
    const inKind = cats.filter((c) => c.kind === kind);
    if (!inKind.length) continue;
    const group = document.createElement("optgroup");
    group.label = KIND_LABEL[kind];
    for (const c of inKind) {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = c.name;
      if (c.name === selected) opt.selected = true;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
  sel.onchange = () => {
    if (sel.value) onPick(sel.value);
  };
  return sel;
}

async function fileTx(txId, category, saveRule) {
  await api(`/transactions/${txId}/category`, {
    method: "POST",
    body: JSON.stringify({ category, save_rule: saveRule }),
  });
}

// A "to file" card with a category dropdown, split button, and rule checkbox.
function fileCard(t, cats, onDone) {
  const card = document.createElement("div");
  card.className = "filecard";
  card.innerHTML = `
    <div class="fc-top"><span class="m">${esc(t.merchant || "(no name)")}</span>
      <span class="amt mono ${t.amount < 0 ? "in" : ""}">$${fmtAmt(t.amount)}</span></div>
    <div class="fc-meta">${fmtDay(t.date)}</div>`;
  const rule = document.createElement("label");
  rule.className = "rule";
  rule.innerHTML = `<input type="checkbox"><span>Always file "${esc(t.merchant || "?")}" this way</span>`;
  const sel = categorySelect(cats, async (name) => {
    card.style.opacity = "0.4";
    try {
      await fileTx(t.tx_id, name, rule.querySelector("input").checked);
    } finally {
      onDone();
    }
  }, t.category);
  const actions = document.createElement("div");
  actions.style.cssText = "display: flex; gap: 8px; align-items: center; margin-top: 8px";
  const splitBtn = document.createElement("button");
  splitBtn.className = "btn ghost";
  splitBtn.textContent = t.categorized_by === "split" ? `Split · ${t.splits?.length || ""} ways`.replace("  ", " ") : "Split";
  splitBtn.onclick = () => openSplitModal(t.tx_id, cats, onDone);
  actions.appendChild(sel);
  actions.appendChild(splitBtn);
  card.appendChild(actions);
  card.appendChild(rule);
  return card;
}

// A filed register row; tapping opens an inline re-file editor.
function registerRow(t, cats, onDone, catColor) {
  const row = document.createElement("button");
  row.className = "rrow";
  const isSplitLine = t.split_id != null;
  const auto = t.categorized_by === "rule" ? " · rule" : "";
  let subtitle;
  if (isSplitLine) {
    subtitle = `${esc(t.category || "")}${t.description ? " · " + esc(t.description) : ""}`;
  } else if (t.categorized_by === "split") {
    subtitle = `Split · ${t.splits ? t.splits.length : ""} ways`;
  } else {
    subtitle = `${esc(t.category || "")}${auto}`;
  }
  row.innerHTML = `
    <span class="d mono">${fmtDay(t.date)}</span>
    <span class="who"><span class="m">${esc(t.merchant || "(no name)")}</span>
      <span class="c" style="${catColor ? "" : ""}">${subtitle}</span></span>
    <span class="amt mono ${t.amount < 0 ? "in" : ""}">$${fmtAmt(t.amount)}</span>`;
  row.onclick = () => {
    if (row.nextSibling && row.nextSibling.classList?.contains("filecard")) {
      row.nextSibling.remove();
      return;
    }
    const editor = fileCard(t, cats, onDone);
    editor.style.cssText = "border: 1.5px solid var(--accent); border-radius: 4px; background: var(--panel2); margin: 6px 0;";
    row.after(editor);
  };
  return row;
}

// ---------- split transaction modal ----------

function fmt2(n) {
  return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function openSplitModal(txId, cats, onDone) {
  const dlg = document.createElement("dialog");
  dlg.className = "splitdlg";
  dlg.innerHTML = '<div class="empty">Loading…</div>';
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();

  api(`/transactions/${txId}/splits`).then((data) => {
    if (data.error) {
      dlg.innerHTML = '<div class="empty">Couldn\'t load this transaction.</div>';
      return;
    }
    renderSplitForm(dlg, data.tx, data.splits, cats, onDone);
  });
}

function renderSplitForm(dlg, tx, existingSplits, cats, onDone) {
  const rows = existingSplits.length
    ? existingSplits.map((s) => ({ amount: s.amount, description: s.description || "", category: s.category }))
    : [{ amount: 0, description: "", category: "" }];

  dlg.innerHTML = "";

  const head = document.createElement("div");
  head.className = "splithead";
  head.innerHTML = `
    <div>
      <strong class="serif" style="font-size: 20px">${esc(tx.merchant || "(no name)")}</strong>
      <div class="lbl">${fmtDay(tx.date)} · total $${fmtAmt(tx.amount)}</div>
    </div>`;
  const close = document.createElement("button");
  close.className = "step";
  close.textContent = "×";
  close.onclick = () => dlg.close();
  head.appendChild(close);
  dlg.appendChild(head);

  const list = document.createElement("div");
  list.className = "splitlist";
  dlg.appendChild(list);

  const addBtn = document.createElement("button");
  addBtn.className = "btn ghost";
  addBtn.style.margin = "10px 0";
  addBtn.textContent = "+ Add a split";
  dlg.appendChild(addBtn);

  const footer = document.createElement("div");
  footer.className = "splitfoot";
  dlg.appendChild(footer);

  const assignedTotal = () => rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const updateFooter = () => {
    const assigned = assignedTotal();
    const remaining = tx.amount - assigned;
    footer.innerHTML = `
      <div class="splitrow-sum"><span>Assigned</span><span class="mono">$${fmt2(assigned)}</span></div>
      <div class="splitrow-sum"><span>Remaining</span><span class="mono" style="color: ${Math.abs(remaining) > 0.005 ? "var(--over)" : "var(--green)"}">$${fmt2(remaining)}</span></div>`;
    const save = document.createElement("button");
    save.className = "btn grow";
    save.style.marginTop = "10px";
    save.textContent = "Save split";
    save.onclick = saveSplit;
    footer.appendChild(save);
  };

  const buildRow = (r) => {
    const rw = document.createElement("div");
    rw.className = "splitentry";
    const amtIn = document.createElement("input");
    amtIn.className = "amtin mono";
    amtIn.type = "text";
    amtIn.inputMode = "decimal";
    amtIn.placeholder = "0";
    amtIn.value = r.amount ? fmt2(r.amount) : "";
    amtIn.oninput = () => {
      r.amount = parseFloat(amtIn.value.replace(/[^0-9.]/g, "")) || 0;
      updateFooter();
    };

    const descIn = document.createElement("input");
    descIn.className = "splitdesc";
    descIn.placeholder = "Description (optional)";
    descIn.value = r.description;
    descIn.oninput = () => {
      r.description = descIn.value;
    };

    const sel = categorySelect(
      cats,
      (name) => {
        r.category = name;
      },
      r.category
    );

    const rm = document.createElement("button");
    rm.className = "step";
    rm.textContent = "×";
    rm.title = "Remove this split";
    rm.onclick = () => {
      const i = rows.indexOf(r);
      if (i >= 0) rows.splice(i, 1);
      rw.remove();
      updateFooter();
    };

    rw.appendChild(amtIn);
    rw.appendChild(descIn);
    rw.appendChild(sel);
    rw.appendChild(rm);
    list.appendChild(rw);
  };

  rows.forEach(buildRow);
  updateFooter();

  addBtn.onclick = () => {
    const remaining = tx.amount - assignedTotal();
    const nr = { amount: remaining, description: "", category: "" };
    rows.push(nr);
    buildRow(nr);
    updateFooter();
  };

  async function saveSplit() {
    const payload = rows
      .filter((r) => r.category && Number(r.amount))
      .map((r) => ({ amount: Number(r.amount), description: r.description, category: r.category }));
    await api(`/transactions/${tx.tx_id}/splits`, {
      method: "POST",
      body: JSON.stringify({ splits: payload }),
    });
    dlg.close();
    onDone();
  }
}

function groupByDate(txs) {
  const groups = [];
  let cur = null;
  for (const t of txs) {
    if (!cur || cur.date !== t.date) {
      cur = { date: t.date, txs: [] };
      groups.push(cur);
    }
    cur.txs.push(t);
  }
  return groups;
}

// ---------- classic: transactions ----------

async function renderTx() {
  const [ov, uncat, filed] = await Promise.all([
    getOverview(),
    api("/transactions?status=uncategorized"),
    api("/transactions?month=" + MONTH),
  ]);
  const v = view();
  v.innerHTML = "";

  if (uncat.length) {
    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.style.marginTop = "10px";
    lbl.textContent = `To file · ${uncat.length}`;
    v.appendChild(lbl);
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "8px";
    for (const t of uncat.slice(0, 10)) card.appendChild(fileCard(t, ov.categories, renderTx));
    v.appendChild(card);
    if (uncat.length > 10) {
      const more = document.createElement("div");
      more.className = "screen-note";
      more.textContent = `…and ${uncat.length - 10} more after these`;
      v.appendChild(more);
    }
  } else if (filed.length) {
    const b = document.createElement("div");
    b.className = "banner";
    b.innerHTML = ICONS.check + "<span><strong>Inbox zero.</strong> Everything is filed.</span>";
    v.appendChild(b);
  }

  const lbl2 = document.createElement("div");
  lbl2.className = "lbl datehead";
  lbl2.textContent = "Filed";
  v.appendChild(lbl2);
  const withCat = filed.filter((t) => t.category || t.categorized_by === "split");
  if (!withCat.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = uncat.length || filed.length
      ? "Nothing filed this month yet."
      : "No transactions yet. Connect a bank in Settings.";
    v.appendChild(e);
  }
  for (const t of withCat) v.appendChild(registerRow(t, ov.categories, renderTx));
}

// ---------- classic: budget ----------

async function renderBudget() {
  const ov = await getOverview();
  const d = derive(ov);
  const v = view();
  v.innerHTML = "";

  if (!ov.budgets.length) {
    v.innerHTML = `<div class="empty">No budgets set for ${monthLabel(MONTH)} yet.</div>`;
    const row = document.createElement("div");
    row.className = "btnrow";
    const set = document.createElement("button");
    set.className = "btn grow";
    set.textContent = "Set budgets";
    set.onclick = () => go({ name: "plan" });
    const copy = document.createElement("button");
    copy.className = "btn ghost";
    copy.textContent = "Copy last month";
    copy.onclick = async () => {
      await api("/budgets/copy", { method: "POST", body: JSON.stringify({ to: MONTH }) });
      renderBudget();
    };
    row.appendChild(set);
    row.appendChild(copy);
    v.appendChild(row);
    return;
  }

  const left = d.totBudget - d.totSpent;
  const di = daysInfo();
  let paceNote = "";
  if (di && d.totBudget > 0) {
    const expected = (d.totBudget * di.day) / di.dim;
    const diff = d.totSpent - expected;
    const projected = (d.totSpent / di.day) * di.dim;
    paceNote =
      diff <= 0
        ? `<div style="font-size: 13px; color: var(--green)">On pace to finish about $${fmtInt(d.totBudget - projected)} under budget.</div>`
        : `<div style="font-size: 13px; color: var(--over)">Running $${fmtInt(diff)} ahead of an even pace.</div>`;
  }
  const hero = document.createElement("div");
  hero.className = "hero";
  hero.innerHTML = `
    <div class="lbl">Left to spend</div>
    <div style="display: flex; align-items: baseline; gap: 10px">
      <span class="big mono" style="color: ${left < 0 ? "var(--over)" : "var(--ink)"}">$${fmtInt(left)}</span>
      <span style="font-size: 13px; color: var(--muted)">of $${fmtInt(d.totBudget)}${di ? ` · ${di.left} days left` : ""}</span>
    </div>${paceNote}`;
  v.appendChild(hero);

  const lbl = document.createElement("div");
  lbl.className = "lbl datehead";
  lbl.textContent = "By category";
  v.appendChild(lbl);

  const rows = d.expense.filter((c) => (d.budget[c.name] || 0) > 0 || (d.spent[c.name] || 0) > 0);
  for (const c of rows) {
    const b = d.budget[c.name] || 0;
    const s = Math.max(0, d.spent[c.name] || 0);
    const over = b > 0 && s > b;
    const pct = b > 0 ? Math.min(100, (s / b) * 100) : 100;
    const row = document.createElement("button");
    row.className = "brow";
    row.innerHTML = `
      <div class="btop">
        <span style="font-size: 14px; ${over ? "color: var(--over); font-weight: 600" : ""}">${esc(c.name)}${over ? " · over" : ""}</span>
        <span class="mono" style="font-size: 13px; ${over ? "color: var(--over)" : ""}">${fmtInt(s)} <span style="color: var(--faint)">/ ${b > 0 ? fmtInt(b) : "—"}</span></span>
      </div>
      <div class="track"><div class="fill${over ? " overc" : b > 0 && s >= b ? " done" : ""}" style="width: ${b > 0 ? pct : 4}%"></div></div>`;
    row.onclick = () => go({ name: "envdetail", arg: c.name, from: "budget" });
    v.appendChild(row);
  }

  const inc = document.createElement("div");
  inc.style.cssText = "margin-top: 12px; padding-top: 10px; font-size: 13px; color: var(--muted)";
  inc.innerHTML = `Income so far <span class="mono" style="color: var(--green)">$${fmtInt(d.incSoFar)}</span>${d.incBudget ? ` of $${fmtInt(d.incBudget)} expected` : ""}`;
  v.appendChild(inc);
}

// ---------- classic: plan (set budgets) ----------

async function renderPlan() {
  const ov = await getOverview();
  const d = derive(ov);
  const v = view();
  v.innerHTML = "";

  const edits = {}; // category -> amount

  const title = document.createElement("div");
  title.className = "serif";
  title.style.cssText = "font-size: 22px; margin-top: 8px";
  title.textContent = "Set budgets — " + monthLabel(MONTH);
  v.appendChild(title);

  const addWrap = document.createElement("div");
  addWrap.style.cssText = "display: flex; gap: 8px; margin-top: 14px; align-items: center; flex-wrap: wrap";
  const addBtn = document.createElement("button");
  addBtn.className = "btn ghost";
  addBtn.textContent = "+ Add budget";
  addWrap.appendChild(addBtn);
  v.appendChild(addWrap);

  addBtn.onclick = () => {
    addWrap.innerHTML = "";
    const nameInput = document.createElement("input");
    nameInput.className = "amtin";
    nameInput.style.width = "140px";
    nameInput.placeholder = "Name";
    let kind = "expense";
    const kindWrap = document.createElement("div");
    kindWrap.style.cssText = "display: flex; gap: 4px";
    const kindBtns = ["expense", "income", "transfer"].map((k) => {
      const b = document.createElement("button");
      b.className = "chip" + (k === kind ? " sel" : "");
      b.textContent = k[0].toUpperCase() + k.slice(1);
      b.onclick = () => {
        kind = k;
        kindBtns.forEach((x) => x.classList.remove("sel"));
        b.classList.add("sel");
      };
      kindWrap.appendChild(b);
      return b;
    });
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn";
    confirmBtn.textContent = "Add";
    confirmBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      confirmBtn.textContent = "Adding…";
      const r = await api("/categories", { method: "POST", body: JSON.stringify({ name, kind }) });
      if (r.error) {
        alert(r.error);
        confirmBtn.textContent = "Add";
        return;
      }
      renderPlan();
    };
    addWrap.appendChild(nameInput);
    addWrap.appendChild(kindWrap);
    addWrap.appendChild(confirmBtn);
    nameInput.focus();
  };

  const summary = document.createElement("div");
  const updateSummary = () => {
    let alloc = 0, incB = 0;
    for (const c of d.expense) alloc += edits[c.name] ?? (d.budget[c.name] || 0);
    for (const c of d.income) incB += edits[c.name] ?? (d.budget[c.name] || 0);
    summary.innerHTML = `
      <div style="display: flex; justify-content: space-between; padding: 12px 0; border-top: 2px solid var(--ink); margin-top: 14px">
        <span style="font-size: 13px; color: var(--muted)">Allocated</span>
        <span class="mono" style="font-size: 14px">$${fmtInt(alloc)}${incB ? ` <span style="color: var(--faint)">of $${fmtInt(incB)}</span>` : ""}</span>
      </div>
      ${incB ? `<div style="display: flex; justify-content: space-between; font-size: 13px; color: var(--muted)"><span>Unallocated (to savings)</span><span class="mono" style="color: var(--green)">$${fmtInt(incB - alloc)}</span></div>` : ""}`;
  };

  const mkRow = (c, step) => {
    const cur = d.budget[c.name] || 0;
    const row = document.createElement("div");
    row.className = "srow";
    row.innerHTML = `<span class="name">${esc(c.name)}</span>`;
    const minus = document.createElement("button");
    minus.className = "step";
    minus.textContent = "−";
    const input = document.createElement("input");
    input.className = "amtin mono";
    input.type = "text";
    input.inputMode = "numeric";
    input.value = cur ? fmtInt(cur) : "";
    input.placeholder = "0";
    const plus = document.createElement("button");
    plus.className = "step";
    plus.textContent = "+";
    const del = document.createElement("button");
    del.className = "step";
    del.textContent = "×";
    del.title = "Delete this budget";
    del.onclick = async () => {
      if (!confirm(`Delete "${c.name}"? Filed transactions keep the old category name.`)) return;
      await api(`/categories/${encodeURIComponent(c.name)}`, { method: "DELETE" });
      renderPlan();
    };
    let saveTimer = null;
    const scheduleSave = (amount) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        api("/budgets", {
          method: "POST",
          body: JSON.stringify({ month: MONTH, budgets: [{ category: c.name, amount }] }),
        });
      }, 500);
    };
    const setVal = (n) => {
      n = Math.max(0, n);
      edits[c.name] = n;
      input.value = n ? fmtInt(n) : "";
      updateSummary();
      scheduleSave(n);
    };
    const val = () => edits[c.name] ?? cur;
    minus.onclick = () => setVal(val() - step);
    plus.onclick = () => setVal(val() + step);
    input.oninput = () => {
      const n = Number(input.value.replace(/[^0-9.]/g, "")) || 0;
      edits[c.name] = n;
      updateSummary();
      scheduleSave(n);
    };
    row.appendChild(minus);
    row.appendChild(input);
    row.appendChild(plus);
    row.appendChild(del);
    return row;
  };

  const lblI = document.createElement("div");
  lblI.className = "lbl datehead";
  lblI.textContent = "Expected income";
  v.appendChild(lblI);
  for (const c of d.income) v.appendChild(mkRow(c, 100));

  const lblE = document.createElement("div");
  lblE.className = "lbl datehead";
  lblE.textContent = "Monthly budgets";
  v.appendChild(lblE);
  for (const c of d.expense) v.appendChild(mkRow(c, 10));

  const lblT = document.createElement("div");
  lblT.className = "lbl datehead";
  lblT.textContent = "Transfers — not counted in totals";
  v.appendChild(lblT);
  for (const c of d.transfer) v.appendChild(mkRow(c, 10));

  v.appendChild(summary);
  updateSummary();

  const row = document.createElement("div");
  row.className = "btnrow";
  row.style.marginTop = "14px";
  const copy = document.createElement("button");
  copy.className = "btn ghost grow";
  copy.textContent = "Copy last month";
  copy.onclick = async () => {
    await api("/budgets/copy", { method: "POST", body: JSON.stringify({ to: MONTH }) });
    renderPlan();
  };
  row.appendChild(copy);
  v.appendChild(row);
}

// ---------- envelopes: home ----------

async function renderEnv() {
  const ov = await getOverview();
  const d = derive(ov);
  const v = view();
  v.innerHTML = "";

  const budgeted = d.expense.filter((c) => (d.budget[c.name] || 0) > 0);
  let leftAll = 0;
  for (const c of budgeted) leftAll += (d.budget[c.name] || 0) - Math.max(0, d.spent[c.name] || 0);
  const di = daysInfo();

  const hero = document.createElement("div");
  hero.className = "hero";
  hero.style.padding = "10px 0";
  hero.innerHTML = `<span class="lbl">Across all envelopes </span>
    <span class="mono" style="font-size: 24px; color: ${leftAll < 0 ? "var(--over)" : "var(--accent)"}">$${fmtInt(leftAll)}</span>
    <span style="font-size: 12px; color: var(--muted)"> left${di ? ` · ${di.left} days` : ""}</span>`;
  v.appendChild(hero);

  if (ov.uncategorized > 0) {
    const tray = document.createElement("button");
    tray.className = "tray";
    tray.style.width = "100%";
    tray.innerHTML = `
      <span style="display: flex; align-items: center; gap: 10px; color: var(--accent)">${ICONS.envelope}
        <span style="color: var(--ink); font-size: 14px"><strong>Unsorted tray</strong> · ${ov.uncategorized} new</span></span>
      <span style="font-size: 13px; font-weight: 600; color: var(--accent)">Sort now →</span>`;
    tray.onclick = () => go({ name: "sort" });
    v.appendChild(tray);
  }

  const grid = document.createElement("div");
  grid.className = "envgrid";
  for (const c of budgeted) {
    const b = d.budget[c.name] || 0;
    const s = Math.max(0, d.spent[c.name] || 0);
    const left = b - s;
    const over = left < 0;
    const pct = Math.min(100, (s / b) * 100);
    const env = document.createElement("button");
    env.className = "env" + (over ? " overe" : "");
    env.innerHTML = `
      <span class="tab"></span>
      <span class="nm" style="${over ? "color: var(--over)" : ""}">${esc(c.name)}</span>
      <span><span class="left mono" style="${over ? "color: var(--over)" : ""}">${over ? "−$" + fmtInt(-left) : "$" + fmtInt(left)}</span>
        <span class="sub"> ${over ? "over" : "left of"} ${fmtInt(b)}</span></span>
      <span class="track"><span class="fill${over ? " overc" : ""}" style="display: block; width: ${pct}%"></span></span>`;
    env.onclick = () => go({ name: "envdetail", arg: c.name });
    grid.appendChild(env);
  }
  const unbudgeted = d.expense.filter((c) => !(d.budget[c.name] > 0));
  if (unbudgeted.length) {
    const add = document.createElement("button");
    add.className = "env";
    add.style.cssText = "border-style: dashed; background: var(--bg); align-items: center; justify-content: center; color: var(--faint)";
    add.innerHTML = `<span style="font-size: 22px; line-height: 1">+</span><span style="font-size: 12px">New envelope</span>`;
    add.onclick = () => {
      add.replaceWith(...unbudgeted.map((c) => {
        const e = document.createElement("button");
        e.className = "env";
        e.style.borderStyle = "dashed";
        e.innerHTML = `<span class="nm">${esc(c.name)}</span><span class="sub">tap to set a budget</span>`;
        e.onclick = () => go({ name: "envdetail", arg: c.name });
        return e;
      }));
    };
    grid.appendChild(add);
  }
  v.appendChild(grid);

  if (!budgeted.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = "No envelopes yet — tap <strong>+ New envelope</strong> above, or ";
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "copy last month";
    a.onclick = async (ev) => {
      ev.preventDefault();
      await api("/budgets/copy", { method: "POST", body: JSON.stringify({ to: MONTH }) });
      renderEnv();
    };
    e.appendChild(a);
    v.appendChild(e);
  }
}

// ---------- envelopes: sort ----------

const SKIPPED = new Set();

async function renderSort() {
  const [ov, allUncat] = await Promise.all([getOverview(), api("/transactions?status=uncategorized")]);
  const v = view();
  v.innerHTML = "";

  let uncat = allUncat.filter((t) => !SKIPPED.has(t.tx_id));
  if (!uncat.length && allUncat.length) {
    // everything left was skipped this pass — start over next time
    SKIPPED.clear();
    go({ name: "env" });
    return;
  }
  if (!uncat.length) {
    const b = document.createElement("div");
    b.className = "banner";
    b.innerHTML = ICONS.check + "<span><strong>Tray empty.</strong> Everything is in an envelope.</span>";
    v.appendChild(b);
    setTimeout(() => go({ name: "env" }), 900);
    return;
  }

  const d = derive(ov);
  const t = uncat[0];

  const top = document.createElement("div");
  top.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-top: 8px";
  top.innerHTML = `<button class="backlink" id="sortBack">${ICONS.back}<span>Envelopes</span></button>
    <span class="lbl">Unsorted · ${uncat.length} left</span><span style="width: 90px"></span>`;
  v.appendChild(top);
  top.querySelector("#sortBack").onclick = () => go({ name: "env" });

  const card = document.createElement("div");
  card.className = "card";
  card.style.cssText = "margin-top: 16px; padding: 20px; display: flex; flex-direction: column; align-items: center; gap: 6px";
  card.innerHTML = `
    <span class="lbl">${fmtDay(t.date)}</span>
    <span class="serif" style="font-size: 26px; text-align: center">${esc(t.merchant || "(no name)")}</span>
    <span class="mono ${t.amount < 0 ? "amt in" : ""}" style="font-size: 32px">$${fmtAmt(t.amount)}</span>`;
  v.appendChild(card);

  const lbl = document.createElement("div");
  lbl.className = "lbl";
  lbl.style.cssText = "text-align: center; margin: 14px 0 4px";
  lbl.textContent = "Drop it in an envelope";
  v.appendChild(lbl);

  const rule = document.createElement("label");
  rule.className = "rule";
  rule.style.justifyContent = "center";
  rule.innerHTML = `<input type="checkbox"><span>"${esc(t.merchant || "?")}" always goes here</span>`;

  const doFile = async (name) => {
    card.style.opacity = "0.4";
    await fileTx(t.tx_id, name, rule.querySelector("input").checked);
    renderSort();
  };

  const grid = document.createElement("div");
  grid.className = "envgrid";
  const budgeted = d.expense.filter((c) => (d.budget[c.name] || 0) > 0);
  const shown = budgeted.length ? budgeted : d.expense;
  for (const c of shown) {
    const b = d.budget[c.name] || 0;
    const s = Math.max(0, d.spent[c.name] || 0);
    const left = b - s;
    const env = document.createElement("button");
    env.className = "env";
    env.innerHTML = `<span class="tab"></span><span class="nm">${esc(c.name)}</span>
      <span class="sub">${b > 0 ? (left < 0 ? "already over" : `<span class="mono">$${fmtInt(left)}</span> left → <span class="mono">$${fmtInt(left - Math.max(0, t.amount))}</span> after`) : "no budget"}</span>`;
    env.onclick = () => doFile(c.name);
    grid.appendChild(env);
  }
  const more = document.createElement("button");
  more.className = "env";
  more.style.borderStyle = "dashed";
  more.innerHTML = `<span class="nm">All categories…</span><span class="sub">income, transfers &amp; the rest</span>`;
  more.onclick = () => {
    more.remove();
    const others = ov.categories.filter((c) => !shown.includes(c));
    for (const c of others) {
      const e = document.createElement("button");
      e.className = "env";
      e.innerHTML = `<span class="nm">${esc(c.name)}</span><span class="sub">${c.kind}</span>`;
      e.onclick = () => doFile(c.name);
      grid.appendChild(e);
    }
  };
  grid.appendChild(more);
  v.appendChild(grid);

  v.appendChild(rule);
  const skip = document.createElement("button");
  skip.className = "btn ghost";
  skip.style.cssText = "width: 100%; margin-top: 12px";
  skip.textContent = "Skip for now";
  skip.onclick = () => {
    SKIPPED.add(t.tx_id);
    renderSort();
  };
  v.appendChild(skip);
}

// ---------- envelope detail (used by both modes) ----------

async function renderEnvDetail(cat, from) {
  const [ov, txs] = await Promise.all([
    getOverview(),
    api(`/transactions?month=${MONTH}&category=${encodeURIComponent(cat)}`),
  ]);
  const d = derive(ov);
  const v = view();
  v.innerHTML = "";

  const back = document.createElement("button");
  back.className = "backlink";
  back.innerHTML = ICONS.back + `<span>${from === "budget" ? "Budget" : MODE === "classic" ? "Budget" : "Envelopes"}</span>`;
  back.onclick = () => go({ name: MODE === "classic" ? "budget" : "env" });
  v.appendChild(back);

  const title = document.createElement("div");
  title.className = "serif";
  title.style.fontSize = "26px";
  title.textContent = cat;
  v.appendChild(title);

  let budget = d.budget[cat] || 0;
  const spent = Math.max(0, d.spent[cat] || 0);

  const box = document.createElement("div");
  box.className = "card";
  box.style.cssText = "margin-top: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px";
  const sum = document.createElement("div");
  const bar = document.createElement("div");
  bar.className = "track";
  const paint = () => {
    const left = budget - spent;
    const over = budget > 0 && left < 0;
    sum.innerHTML = `<div style="display: flex; justify-content: space-between; align-items: baseline">
      <span><span class="mono" style="font-size: 28px; color: ${over ? "var(--over)" : "var(--ink)"}">${over ? "−$" + fmtInt(-left) : "$" + fmtInt(left)}</span>
      <span style="font-size: 13px; color: var(--muted)"> ${budget > 0 ? (over ? "over" : "left") : "spent"}</span></span>
      <span style="font-size: 12px; color: var(--muted)">spent <span class="mono">$${fmtInt(spent)}</span></span></div>`;
    const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
    bar.innerHTML = `<div class="fill${over ? " overc" : ""}" style="width: ${pct}%"></div>`;
  };
  box.appendChild(sum);
  box.appendChild(bar);

  const stepRow = document.createElement("div");
  stepRow.style.cssText = "display: flex; align-items: center; justify-content: space-between";
  stepRow.innerHTML = `<span class="lbl">Envelope size</span>`;
  const ctr = document.createElement("div");
  ctr.style.cssText = "display: flex; align-items: center; gap: 6px";
  const minus = document.createElement("button");
  minus.className = "step";
  minus.textContent = "−";
  const input = document.createElement("input");
  input.className = "amtin mono";
  input.type = "text";
  input.inputMode = "numeric";
  input.style.width = "80px";
  input.value = budget ? fmtInt(budget) : "";
  input.placeholder = "0";
  const plus = document.createElement("button");
  plus.className = "step";
  plus.textContent = "+";
  ctr.appendChild(minus);
  ctr.appendChild(input);
  ctr.appendChild(plus);
  stepRow.appendChild(ctr);
  box.appendChild(stepRow);

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api("/budgets", {
        method: "POST",
        body: JSON.stringify({ month: MONTH, budgets: [{ category: cat, amount: budget }] }),
      });
    }, 500);
  };
  const setBudget = (n) => {
    budget = Math.max(0, n);
    input.value = budget ? fmtInt(budget) : "";
    paint();
    save();
  };
  minus.onclick = () => setBudget(budget - 10);
  plus.onclick = () => setBudget(budget + 10);
  input.oninput = () => {
    budget = Number(input.value.replace(/[^0-9.]/g, "")) || 0;
    paint();
    save();
  };
  paint();
  v.appendChild(box);

  const lbl = document.createElement("div");
  lbl.className = "lbl datehead";
  lbl.textContent = `${MODE === "classic" ? "This month" : "In this envelope"} · ${txs.length}`;
  v.appendChild(lbl);
  if (!txs.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Nothing here this month.";
    v.appendChild(e);
  }
  for (const t of txs) v.appendChild(registerRow(t, ov.categories, () => renderEnvDetail(cat, from)));
}

// ---------- activity (envelopes mode) ----------

async function renderActivity() {
  const [ov, txs] = await Promise.all([getOverview(), api("/transactions?month=" + MONTH)]);
  const v = view();
  v.innerHTML = "";

  if (ov.uncategorized > 0) {
    const tray = document.createElement("button");
    tray.className = "tray";
    tray.style.width = "100%";
    tray.innerHTML = `<span style="font-size: 14px"><strong>${ov.uncategorized} unsorted</strong></span>
      <span style="font-size: 13px; font-weight: 600; color: var(--accent)">Sort now →</span>`;
    tray.onclick = () => go({ name: "sort" });
    v.appendChild(tray);
  }

  const withCat = txs.filter((t) => t.category || t.categorized_by === "split");
  if (!withCat.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No activity this month yet.";
    v.appendChild(e);
    return;
  }
  for (const g of groupByDate(withCat)) {
    const h = document.createElement("div");
    h.className = "lbl datehead";
    h.textContent = fmtDay(g.date);
    v.appendChild(h);
    for (const t of g.txs) v.appendChild(registerRow(t, ov.categories, renderActivity));
  }
}

// ---------- settings ----------

async function renderSettings() {
  const v = view();
  v.innerHTML = "";

  const back = document.createElement("button");
  back.className = "backlink";
  back.innerHTML = ICONS.back + "<span>Back</span>";
  back.onclick = () => go(defaultRoute());
  v.appendChild(back);

  const title = document.createElement("div");
  title.className = "serif";
  title.style.fontSize = "26px";
  title.textContent = "Settings";
  v.appendChild(title);

  const lbl = document.createElement("div");
  lbl.className = "lbl datehead";
  lbl.textContent = "Layout";
  v.appendChild(lbl);

  const opts = document.createElement("div");
  opts.style.cssText = "display: flex; gap: 10px; margin-top: 8px";
  const mk = (mode, t, s) => {
    const o = document.createElement("button");
    o.className = "opt" + (MODE === mode ? " sel" : "");
    o.innerHTML = `<span class="t">${t}</span><span class="s">${s}</span>`;
    o.onclick = () => {
      MODE = mode;
      localStorage.setItem("layoutMode", mode);
      renderSettings();
      tabbar();
    };
    return o;
  };
  opts.appendChild(mk("classic", "Classic ledger", "Tabs: transactions, budget, plan. The register view."));
  opts.appendChild(mk("envelopes", "Envelopes", "Budgets as envelopes; new transactions land in a tray."));
  v.appendChild(opts);

  const lbl2 = document.createElement("div");
  lbl2.className = "lbl datehead";
  lbl2.textContent = "Banks & data";
  v.appendChild(lbl2);

  const connect = document.createElement("button");
  connect.className = "setrow";
  connect.innerHTML = `<span>Connect a bank</span><span style="color: var(--accent)">Plaid →</span>`;
  connect.onclick = connectBank;
  v.appendChild(connect);

  const sync = document.createElement("button");
  sync.className = "setrow";
  sync.innerHTML = `<span>Sync now</span><span style="color: var(--faint)">pull latest</span>`;
  sync.onclick = async () => {
    sync.querySelector("span:last-child").textContent = "syncing…";
    const r = await api("/sync_now", { method: "POST" });
    sync.querySelector("span:last-child").textContent = `+${r.added} new`;
  };
  v.appendChild(sync);

  const wh = document.createElement("button");
  wh.className = "setrow";
  wh.innerHTML = `<span>Update bank webhooks</span><span style="color: var(--faint)">after a URL change</span>`;
  wh.onclick = async () => {
    wh.querySelector("span:last-child").textContent = "updating…";
    const r = await api("/update_webhooks", { method: "POST" });
    wh.querySelector("span:last-child").textContent = `${r.updated} updated`;
  };
  v.appendChild(wh);

  const out = document.createElement("button");
  out.className = "setrow";
  out.innerHTML = `<span>Sign out</span><span style="color: var(--faint)"></span>`;
  out.onclick = () => {
    localStorage.removeItem("appKey");
    KEY = "";
    showLogin();
  };
  v.appendChild(out);

  const note = document.createElement("div");
  note.className = "screen-note";
  note.textContent = "Ledger — your money, on paper.";
  v.appendChild(note);
}

async function connectBank() {
  const { link_token } = await api("/create_link_token", { method: "POST" });
  const handler = Plaid.create({
    token: link_token,
    onSuccess: async (public_token, metadata) => {
      await api("/exchange_public_token", {
        method: "POST",
        body: JSON.stringify({ public_token, institution_name: metadata.institution?.name }),
      });
      go(defaultRoute());
    },
  });
  handler.open();
}

// ---------- router ----------

function defaultRoute() {
  return { name: MODE === "classic" ? "tx" : "env" };
}

const RENDERERS = {
  tx: renderTx,
  budget: renderBudget,
  plan: renderPlan,
  env: renderEnv,
  sort: renderSort,
  activity: renderActivity,
  settings: renderSettings,
  envdetail: (r) => renderEnvDetail(r.arg, r.from),
};

function go(route) {
  ROUTE = route;
  tabbar();
  $("tabbar").style.display = ["sort", "settings"].includes(route.name) ? "none" : "flex";
  view().innerHTML = '<div class="empty">Loading…</div>';
  const fn = RENDERERS[route.name] || renderTx;
  Promise.resolve(fn(route)).catch((e) => {
    if (e.message !== "unauthorized") {
      view().innerHTML = '<div class="empty">Couldn\'t load — pull to refresh or check your connection.</div>';
    }
  });
}

// header controls

function updateMonthNav() {
  const btn = $("mNext");
  if (!btn) return;
  const atBoundary = MONTH >= LATEST_MONTH;
  btn.textContent = atBoundary ? "+" : "›";
  btn.title = atBoundary ? "Set up next month" : "";
  btn.setAttribute("aria-label", atBoundary ? "Set up next month" : "Next month");
}

$("mCur").textContent = monthLabel(MONTH);
$("mPrev").onclick = () => {
  MONTH = shiftMonth(MONTH, -1);
  $("mCur").textContent = monthLabel(MONTH);
  updateMonthNav();
  go(ROUTE || defaultRoute());
};
$("mNext").onclick = async () => {
  const btn = $("mNext");
  if (MONTH >= LATEST_MONTH) {
    btn.disabled = true;
    btn.textContent = "…";
    try {
      const r = await api("/months/next", { method: "POST", body: JSON.stringify({ copy: true }) });
      MONTH = r.month;
      LATEST_MONTH = r.month;
    } finally {
      btn.disabled = false;
    }
  } else {
    MONTH = shiftMonth(MONTH, 1);
  }
  $("mCur").textContent = monthLabel(MONTH);
  updateMonthNav();
  go(ROUTE || defaultRoute());
};
updateMonthNav();
$("gear").onclick = () => go({ name: "settings" });
$("homeBtn").onclick = () => go(defaultRoute());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

if (!KEY) showLogin();
else go(defaultRoute());
