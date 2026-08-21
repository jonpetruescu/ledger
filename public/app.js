// Ledger — front end.

let KEY = localStorage.getItem("appKey") || "";
let MONTH = new Date().toISOString().slice(0, 7);
let LATEST_MONTH = MONTH; // furthest month you're allowed to view; refreshed from /overview
let UNCATEGORIZED = 0; // refreshed from /overview; drives the Transactions tab badge
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
  UNCATEGORIZED = ov.uncategorized || 0;
  tabbar();
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
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M8 12.5l2.6 2.6L16 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  split: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 20L12 12V4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 12L20 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 4h5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const TABS = [
  ["budget", "Budget", ICONS.bars],
  ["tx", "Transactions", ICONS.list],
  ["plan", "Plan", ICONS.sliders],
];

function tabbar() {
  const nav = $("tabbar");
  const keepFoot = ROUTE && ROUTE.name === "plan" ? nav.querySelector(".planfoot") : null;
  nav.innerHTML = "";
  if (ROUTE && ROUTE.name === "plan") {
    nav.appendChild(keepFoot || document.createElement("div"));
    if (!keepFoot) nav.lastChild.className = "planfoot";
  }
  const tabsRow = document.createElement("div");
  tabsRow.className = "tabsrow";
  for (const [name, label, icon] of TABS) {
    const b = document.createElement("button");
    b.className = ROUTE && ROUTE.name === name ? "on" : "";
    b.innerHTML = icon + `<span>${label}</span>` + (name === "tx" && UNCATEGORIZED > 0 ? '<span class="badge"></span>' : "");
    b.onclick = () => go({ name });
    tabsRow.appendChild(b);
  }
  nav.appendChild(tabsRow);
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
  // Guard against a double-tap opening two stacked dialogs.
  document.querySelectorAll("dialog.splitdlg").forEach((d) => d.remove());

  const dlg = document.createElement("dialog");
  dlg.className = "splitdlg";
  dlg.innerHTML = '<div class="empty">Loading…</div>';
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();

  // On mobile, the on-screen keyboard shrinks the visual viewport but not
  // the layout viewport a <dialog> sizes against, which can push the fixed
  // Assigned/Remaining/Save footer out of reach. Track it explicitly.
  if (window.visualViewport) {
    const fit = () => {
      dlg.style.maxHeight = window.visualViewport.height * 0.92 + "px";
    };
    fit();
    window.visualViewport.addEventListener("resize", fit);
    dlg.addEventListener("close", () => window.visualViewport.removeEventListener("resize", fit));
  }

  api(`/transactions/${txId}/splits`).then((data) => {
    if (data.error) {
      dlg.innerHTML = '<div class="empty">Couldn\'t load this transaction.</div>';
      return;
    }
    renderSplitForm(dlg, data.tx, data.splits, cats, onDone);
  });
}

// A labeled field: label above, input/select below, optional $ prefix and
// an × to clear the value — matches native-app form conventions.
function splitField(labelText, control, { prefix, clearable } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "splitfield";
  const lbl = document.createElement("div");
  lbl.className = "splitfieldlbl";
  lbl.textContent = labelText;
  wrap.appendChild(lbl);

  const inputWrap = document.createElement("div");
  inputWrap.className = "splitinputwrap";
  if (prefix) {
    const pre = document.createElement("span");
    pre.className = "splitprefix";
    pre.textContent = prefix;
    inputWrap.appendChild(pre);
    control.classList.add("has-prefix");
  }
  inputWrap.appendChild(control);
  if (clearable) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "splitclear";
    clear.textContent = "×";
    clear.tabIndex = -1;
    clear.onclick = () => {
      control.value = "";
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.focus();
    };
    inputWrap.appendChild(clear);
  }
  wrap.appendChild(inputWrap);
  return wrap;
}

function renderSplitForm(dlg, tx, existingSplits, cats, onDone) {
  const rows = existingSplits.length
    ? existingSplits.map((s) => ({ amount: s.amount, description: s.description || "", category: s.category }))
    : [{ amount: tx.amount, description: "", category: "" }];

  dlg.innerHTML = "";

  const head = document.createElement("div");
  head.className = "splithead";
  head.innerHTML = `
    <div>
      <div style="display: flex; align-items: center; gap: 8px">
        ${ICONS.split}
        <strong class="serif" style="font-size: 20px">Split Transaction</strong>
      </div>
      <div class="lbl" style="margin-top: 4px">${fmtDay(tx.date)} · ${esc(tx.merchant || "(no name)")} · Original amount: $${fmtAmt(tx.amount)}</div>
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
  addBtn.style.cssText = "margin: 10px 0; width: 100%";
  addBtn.textContent = "+ Add split";
  dlg.appendChild(addBtn);

  const footer = document.createElement("div");
  footer.className = "splitfoot";
  dlg.appendChild(footer);

  const assignedTotal = () => rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const updateFooter = () => {
    const assigned = assignedTotal();
    const remaining = tx.amount - assigned;
    footer.innerHTML = `
      <div class="splitfoot-grid">
        <div><div class="splitfieldlbl">Assigned</div><div class="mono" style="font-size: 20px">$${fmt2(assigned)}</div></div>
        <div><div class="splitfieldlbl">Remaining</div><div class="mono" style="font-size: 20px; color: ${Math.abs(remaining) > 0.005 ? "var(--over)" : "var(--green)"}">$${fmt2(remaining)}</div></div>
      </div>
      <div class="err" id="splitErr"></div>`;
    const row = document.createElement("div");
    row.className = "btnrow";
    row.style.marginTop = "6px";
    const cancel = document.createElement("button");
    cancel.className = "btn ghost grow";
    cancel.textContent = "Cancel";
    cancel.onclick = () => dlg.close();
    const save = document.createElement("button");
    save.className = "btn grow";
    save.textContent = "Save Splits";
    save.onclick = () => saveSplit(save);
    row.appendChild(cancel);
    row.appendChild(save);
    footer.appendChild(row);
  };

  const buildCard = (r) => {
    const card = document.createElement("div");
    card.className = "splitcard";

    const amtIn = document.createElement("input");
    amtIn.className = "amtin mono";
    amtIn.type = "text";
    amtIn.inputMode = "decimal";
    amtIn.placeholder = "0.00";
    amtIn.value = r.amount ? fmt2(r.amount) : "";
    amtIn.oninput = () => {
      r.amount = parseFloat(amtIn.value.replace(/[^0-9.]/g, "")) || 0;
      updateFooter();
    };
    card.appendChild(splitField("Amount", amtIn, { prefix: "$", clearable: true }));

    const descIn = document.createElement("input");
    descIn.placeholder = "What was this for?";
    descIn.value = r.description;
    descIn.oninput = () => {
      r.description = descIn.value;
    };
    card.appendChild(splitField("Description", descIn, { clearable: true }));

    const sel = categorySelect(
      cats,
      (name) => {
        r.category = name;
      },
      r.category
    );
    card.appendChild(splitField("Category", sel));

    if (rows.length > 1) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "splitremove";
      rm.textContent = "Remove this split";
      rm.onclick = () => {
        const i = rows.indexOf(r);
        if (i >= 0) rows.splice(i, 1);
        card.remove();
        updateFooter();
      };
      card.appendChild(rm);
    }

    list.appendChild(card);
  };

  const rebuildList = () => {
    list.innerHTML = "";
    rows.forEach(buildCard);
  };

  rebuildList();
  updateFooter();

  addBtn.onclick = () => {
    const remaining = tx.amount - assignedTotal();
    rows.push({ amount: Math.max(0, remaining), description: "", category: "" });
    rebuildList();
    updateFooter();
  };

  async function saveSplit(saveBtn) {
    const errEl = footer.querySelector("#splitErr");
    const payload = rows
      .filter((r) => r.category && Number(r.amount))
      .map((r) => ({ amount: Number(r.amount), description: r.description, category: r.category }));
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const r = await api(`/transactions/${tx.tx_id}/splits`, {
        method: "POST",
        body: JSON.stringify({ splits: payload }),
      });
      if (r?.error) throw new Error(r.error);
      dlg.close();
      onDone();
    } catch (e) {
      if (errEl) errEl.textContent = "Couldn't save — check your connection and try again.";
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Splits";
    }
  }
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

  if (ov.uncategorized > 0) {
    const tray = document.createElement("button");
    tray.className = "tray";
    tray.style.width = "100%";
    tray.innerHTML = `<span style="font-size: 14px"><strong>${ov.uncategorized}</strong> to file</span>
      <span style="font-size: 13px; font-weight: 600; color: var(--accent)">Review →</span>`;
    tray.onclick = () => go({ name: "tx" });
    v.appendChild(tray);
  }

  if (!ov.budgets.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = `No budgets set for ${monthLabel(MONTH)} yet.`;
    v.appendChild(empty);
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
    row.onclick = () => go({ name: "category", arg: c.name });
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
  v.style.paddingBottom = "150px";

  const edits = {}; // category -> amount

  const title = document.createElement("div");
  title.className = "serif";
  title.style.cssText = "font-size: 22px; margin-top: 8px";
  title.textContent = "Set budgets — " + monthLabel(MONTH);
  v.appendChild(title);

  const allGroups = [...new Set(ov.categories.map((c) => c.group_name).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );

  // A group <select> (existing groups + "No group" + "+ New group…"), with
  // a text input that appears only when creating a brand-new group name —
  // picking from the list is one tap and can't typo into a near-duplicate.
  const makeGroupPicker = (selected) => {
    const wrap = document.createElement("div");
    wrap.className = "groupselwrap";
    let value = selected || "";
    const sel = document.createElement("select");
    sel.className = "catselect";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "No group";
    sel.appendChild(noneOpt);
    for (const g of allGroups) {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      sel.appendChild(opt);
    }
    const newOpt = document.createElement("option");
    newOpt.value = "__new__";
    newOpt.textContent = "+ New group…";
    sel.appendChild(newOpt);

    const customIn = document.createElement("input");
    customIn.className = "amtin";
    customIn.style.cssText = "display: none; width: 130px";
    customIn.placeholder = "New group name";

    if (selected && !allGroups.includes(selected)) {
      sel.value = "__new__";
      customIn.style.display = "";
      customIn.value = selected;
    } else {
      sel.value = selected || "";
    }

    sel.onchange = () => {
      if (sel.value === "__new__") {
        customIn.style.display = "";
        customIn.value = "";
        customIn.focus();
        value = "";
      } else {
        customIn.style.display = "none";
        value = sel.value;
      }
    };
    customIn.oninput = () => {
      value = customIn.value.trim();
    };

    wrap.appendChild(sel);
    wrap.appendChild(customIn);
    wrap.getValue = () => value;
    return wrap;
  };

  const topRow = document.createElement("div");
  topRow.style.cssText = "display: flex; gap: 8px; margin-top: 14px; align-items: center; flex-wrap: wrap";
  const addBtn = document.createElement("button");
  addBtn.className = "btn ghost";
  addBtn.textContent = "+ Add budget";
  const copyBtn = document.createElement("button");
  copyBtn.className = "btn ghost small";
  copyBtn.textContent = "Copy last month";
  copyBtn.onclick = async () => {
    await api("/budgets/copy", { method: "POST", body: JSON.stringify({ to: MONTH }) });
    renderPlan();
  };
  topRow.appendChild(addBtn);
  topRow.appendChild(copyBtn);
  v.appendChild(topRow);

  addBtn.onclick = () => {
    topRow.innerHTML = "";
    const nameInput = document.createElement("input");
    nameInput.className = "amtin";
    nameInput.style.width = "120px";
    nameInput.placeholder = "Name";
    const groupPicker = makeGroupPicker("");
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
      const r = await api("/categories", {
        method: "POST",
        body: JSON.stringify({ name, kind, group_name: groupPicker.getValue() || undefined }),
      });
      if (r.error) {
        alert(r.error);
        confirmBtn.textContent = "Add";
        return;
      }
      renderPlan();
    };
    topRow.appendChild(nameInput);
    topRow.appendChild(groupPicker);
    topRow.appendChild(kindWrap);
    topRow.appendChild(confirmBtn);
    nameInput.focus();
  };

  // The Allocated/Unallocated summary lives fixed in the tab bar (see
  // tabbar()), so it's always visible while editing, keyboard or not.
  const footEl = $("tabbar").querySelector(".planfoot");
  const updateSummary = () => {
    if (!footEl) return;
    let alloc = 0, incB = 0;
    for (const c of d.expense) alloc += edits[c.name] ?? (d.budget[c.name] || 0);
    for (const c of d.income) incB += edits[c.name] ?? (d.budget[c.name] || 0);
    footEl.innerHTML = `
      <div style="display: flex; justify-content: space-between">
        <span style="font-size: 13px; color: var(--muted)">Allocated</span>
        <span class="mono" style="font-size: 14px">$${fmtInt(alloc)}${incB ? ` <span style="color: var(--faint)">of $${fmtInt(incB)}</span>` : ""}</span>
      </div>
      ${incB ? `<div style="display: flex; justify-content: space-between; font-size: 13px; color: var(--muted)"><span>Unallocated (to savings)</span><span class="mono" style="color: var(--green)">$${fmtInt(incB - alloc)}</span></div>` : ""}`;
  };

  const openEditModal = (c) => {
    document.querySelectorAll("dialog.editdlg").forEach((d) => d.remove());
    const dlg = document.createElement("dialog");
    dlg.className = "editdlg";
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => dlg.remove());

    const title = document.createElement("strong");
    title.className = "serif";
    title.style.cssText = "font-size: 20px; display: block";
    title.textContent = "Edit budget";
    dlg.appendChild(title);

    const nameIn = document.createElement("input");
    nameIn.value = c.name;
    nameIn.placeholder = "Name";
    dlg.appendChild(nameIn);

    const groupPicker = makeGroupPicker(c.group_name || "");
    groupPicker.style.margin = "0 0 12px";
    dlg.appendChild(groupPicker);

    const err = document.createElement("div");
    err.className = "err";
    dlg.appendChild(err);

    const row = document.createElement("div");
    row.className = "btnrow";
    const save = document.createElement("button");
    save.className = "btn grow";
    save.textContent = "Save";
    save.onclick = async () => {
      const newName = nameIn.value.trim();
      if (!newName) return;
      save.textContent = "Saving…";
      const r = await api(`/categories/${encodeURIComponent(c.name)}`, {
        method: "PUT",
        body: JSON.stringify({ name: newName, group_name: groupPicker.getValue() || null }),
      });
      if (r.error) {
        err.textContent = r.error;
        save.textContent = "Save";
        return;
      }
      dlg.close();
      renderPlan();
    };
    const cancel = document.createElement("button");
    cancel.className = "btn ghost";
    cancel.textContent = "Cancel";
    cancel.onclick = () => dlg.close();
    row.appendChild(save);
    row.appendChild(cancel);
    dlg.appendChild(row);

    dlg.showModal();
    nameIn.focus();
  };

  const mkRow = (c, step) => {
    const cur = d.budget[c.name] || 0;
    const row = document.createElement("div");
    row.className = "srow";
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "name";
    nameBtn.textContent = c.name;
    nameBtn.onclick = () => openEditModal(c);
    row.appendChild(nameBtn);
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

  // Categories in a kind, clustered under any group they belong to.
  const renderKindSection = (label, cats, step) => {
    const lbl = document.createElement("div");
    lbl.className = "lbl datehead";
    lbl.textContent = label;
    v.appendChild(lbl);

    const groups = {};
    const ungrouped = [];
    for (const c of cats) {
      if (c.group_name) (groups[c.group_name] ||= []).push(c);
      else ungrouped.push(c);
    }
    const groupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    for (const g of groupNames) {
      const box = document.createElement("div");
      box.className = "groupbox";
      const gh = document.createElement("div");
      gh.className = "grouphead";
      gh.textContent = g;
      box.appendChild(gh);
      for (const c of groups[g]) box.appendChild(mkRow(c, step));
      v.appendChild(box);
    }
    if (ungrouped.length) {
      if (groupNames.length) {
        const uh = document.createElement("div");
        uh.className = "grouphead ungrouped";
        uh.textContent = "Ungrouped";
        v.appendChild(uh);
      }
      for (const c of ungrouped) v.appendChild(mkRow(c, step));
    }
  };

  renderKindSection("Expected income", d.income, 100);
  renderKindSection("Monthly budgets", d.expense, 10);
  renderKindSection("Transfers — not counted in totals", d.transfer, 10);

  updateSummary();
}

// ---------- category detail ----------

async function renderCategoryDetail(cat) {
  const [ov, txs] = await Promise.all([
    getOverview(),
    api(`/transactions?month=${MONTH}&category=${encodeURIComponent(cat)}`),
  ]);
  const d = derive(ov);
  const v = view();
  v.innerHTML = "";

  const back = document.createElement("button");
  back.className = "backlink";
  back.innerHTML = ICONS.back + "<span>Budget</span>";
  back.onclick = () => go({ name: "budget" });
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
  stepRow.innerHTML = `<span class="lbl">Budget</span>`;
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
  lbl.textContent = `This month · ${txs.length}`;
  v.appendChild(lbl);
  if (!txs.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Nothing here this month.";
    v.appendChild(e);
  }
  for (const t of txs) v.appendChild(registerRow(t, ov.categories, () => renderCategoryDetail(cat)));
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

  const lblN = document.createElement("div");
  lblN.className = "lbl datehead";
  lblN.textContent = "Notifications";
  v.appendChild(lblN);

  const pushRow = document.createElement("button");
  pushRow.className = "setrow";
  pushRow.innerHTML = `<span>Push notifications</span><span style="color: var(--faint)">checking…</span>`;
  v.appendChild(pushRow);
  setUpPushRow(pushRow);

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

  const lbl3 = document.createElement("div");
  lbl3.className = "lbl datehead";
  lbl3.textContent = "Months";
  v.appendChild(lbl3);

  const realCur = new Date().toISOString().slice(0, 7);
  if (LATEST_MONTH > realCur) {
    const delMonth = document.createElement("button");
    delMonth.className = "setrow";
    delMonth.innerHTML = `<span>Delete ${esc(monthLabel(LATEST_MONTH))}</span><span style="color: var(--over)">undo</span>`;
    delMonth.onclick = async () => {
      if (!confirm(`Delete ${monthLabel(LATEST_MONTH)}? Its budgets will be removed too.`)) return;
      const r = await api("/months/latest", { method: "DELETE" });
      if (r.error) {
        alert(r.error);
        return;
      }
      if (MONTH >= LATEST_MONTH) MONTH = shiftMonth(MONTH, -1);
      LATEST_MONTH = realCur;
      renderSettings();
    };
    v.appendChild(delMonth);
  } else {
    const mnote = document.createElement("div");
    mnote.className = "screen-note";
    mnote.style.padding = "8px 0";
    mnote.textContent = "No set-up month ahead of today to delete.";
    v.appendChild(mnote);
  }

  const note = document.createElement("div");
  note.className = "screen-note";
  note.textContent = "Ledger — your money, on paper.";
  v.appendChild(note);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function setUpPushRow(row) {
  const status = row.querySelector("span:last-child");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    status.textContent = "not supported on this browser";
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const paint = (subscribed) => {
    status.textContent = subscribed ? "on · tap to turn off" : "off · tap to turn on";
  };
  paint(!!sub);
  row.onclick = async () => {
    const reg2 = await navigator.serviceWorker.ready;
    const existing = await reg2.pushManager.getSubscription();
    if (existing) {
      await api("/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: existing.endpoint }),
      });
      await existing.unsubscribe();
      paint(false);
      return;
    }
    if (Notification.permission === "denied") {
      alert("Notifications are blocked for this site — check your browser or device settings.");
      return;
    }
    const { key } = await api("/push/vapid_public_key");
    if (!key) {
      alert("Push notifications aren't configured on the server yet.");
      return;
    }
    const newSub = await reg2.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api("/push/subscribe", { method: "POST", body: JSON.stringify(newSub.toJSON()) });
    paint(true);
  };
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
  return { name: "budget" };
}

const RENDERERS = {
  tx: renderTx,
  budget: renderBudget,
  plan: renderPlan,
  settings: renderSettings,
  category: (r) => renderCategoryDetail(r.arg),
};

function go(route) {
  ROUTE = route;
  tabbar();
  $("tabbar").style.display = route.name === "settings" ? "none" : "flex";
  view().style.paddingBottom = "";
  view().innerHTML = '<div class="empty">Loading…</div>';
  const fn = RENDERERS[route.name] || renderBudget;
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
