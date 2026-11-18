// Reimbursements: purchases you paid for and need to claim back (employer, insurance, a friend…).
// They're regular bills in `documents` with reimb* fields, so the receipt photo and AI reading come for free.
import { live, get, upsert } from '../state.js';
import { $, $$, esc, setTitle, toast, hydrate, fmtDate, fmtMoney, daysFromToday, today, openSheet, download, docSym } from '../ui.js';
import { DTYPES } from './docs.js';

export const RSTATUS = {
  pending: { e: '⏳', l: 'To claim' },
  submitted: { e: '📨', l: 'Submitted' },
  paid: { e: '✅', l: 'Received' },
  rejected: { e: '✕', l: 'Rejected' },
};
export const isClaim = d => !!d.reimbStatus;
export const claims = () => live('documents').filter(isClaim);
export const openClaims = () => claims().filter(d => ['pending', 'submitted'].includes(d.reimbStatus));

// Days until the claim deadline, only while it still matters.
export const deadlineIn = d => (d.reimbStatus === 'pending' ? daysFromToday(d.reimbDeadline) : null);

// Sum amounts per currency, e.g. "₹12,400 + $35".
export function totals(list, field = 'amount') {
  const by = {};
  for (const d of list) { const v = +d[field]; if (v) by[docSym(d)] = (by[docSym(d)] || 0) + v; }
  return Object.entries(by).map(([s, v]) => fmtMoney(v, s)).join(' + ');
}

export const statusBadge = d => `<span class="status r-${d.reimbStatus}">${RSTATUS[d.reimbStatus]?.e || ''} ${RSTATUS[d.reimbStatus]?.l || ''}</span>`;

// The one-tap "next step" buttons, shared by the list and the document page.
export function claimActions(d) {
  if (d.reimbStatus === 'pending') return `<button class="btn" data-ra="submit" data-id="${d.id}">📨 Mark submitted</button>`;
  if (d.reimbStatus === 'submitted') return `<button class="btn" data-ra="paid" data-id="${d.id}">✅ Got paid</button><button class="btn ghost" data-ra="reject" data-id="${d.id}">Rejected</button>`;
  return `<button class="btn ghost" data-ra="reopen" data-id="${d.id}">↺ Reopen</button>`;
}

export function wireClaimActions(root, after) {
  $$('[data-ra]', root).forEach(b => b.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    const d = get('documents', b.dataset.id);
    if (!d) return;
    const save = (patch, msg) => { upsert('documents', { ...d, ...patch }); toast(msg); after(); };
    const a = b.dataset.ra;
    if (a === 'submit') {
      const s = openSheet(`<h3>📨 Claim submitted</h3><p class="muted small">${esc(d.title || '')}</p>
        <label>Submitted on<input type="date" id="r-on" value="${today()}"></label>
        <label>Claim / reference no. <small>(optional)</small><input id="r-ref" value="${esc(d.reimbRef || '')}"></label>
        <button class="btn primary block" id="r-ok">Save</button>`);
      $('#r-ok', s.el).onclick = () => { s.close(); save({ reimbStatus: 'submitted', reimbSubmittedOn: $('#r-on', s.el).value || today(), reimbRef: $('#r-ref', s.el).value.trim() || null }, 'Marked as submitted'); };
    } else if (a === 'paid') {
      const s = openSheet(`<h3>✅ Reimbursement received</h3><p class="muted small">${esc(d.title || '')}${d.amount ? ' · claimed ' + fmtMoney(d.amount, docSym(d)) : ''}</p>
        <label>Amount received<input type="number" inputmode="decimal" step="0.01" id="r-amt" value="${esc(d.reimbPaidAmount ?? d.amount ?? '')}"></label>
        <label>Received on<input type="date" id="r-on" value="${today()}"></label>
        <button class="btn primary block" id="r-ok">Save</button>`);
      $('#r-ok', s.el).onclick = () => {
        const v = $('#r-amt', s.el).value;
        s.close(); save({ reimbStatus: 'paid', reimbPaidAmount: v === '' ? null : +v, reimbPaidOn: $('#r-on', s.el).value || today() }, 'Marked as received 🎉');
      };
    } else if (a === 'reject') save({ reimbStatus: 'rejected' }, 'Marked as rejected');
    else if (a === 'reopen') save({ reimbStatus: d.reimbSubmittedOn ? 'submitted' : 'pending', reimbPaidOn: null, reimbPaidAmount: null }, 'Reopened');
  });
}

/* ---------------- list ---------------- */
let sfilter = 'open', ffilter = '';
export function reimbList(view) {
  setTitle('Reimbursements', true);
  const all = claims().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const pending = all.filter(d => d.reimbStatus === 'pending');
  const submitted = all.filter(d => d.reimbStatus === 'submitted');
  const year = String(new Date().getFullYear());
  const paidYear = all.filter(d => d.reimbStatus === 'paid' && (d.reimbPaidOn || d.date || '').startsWith(year));
  const froms = [...new Set(all.map(d => d.reimbFrom).filter(Boolean))].sort();
  if (ffilter && !froms.includes(ffilter)) ffilter = '';
  const due = pending.filter(d => { const n = deadlineIn(d); return n !== null && n <= 14; });

  view.innerHTML = `
    <div class="tiles rtiles">
      <button class="card tile ${sfilter === 'pending' ? 'sel' : ''}" data-s="pending"><b>${totals(pending) || pending.length}</b><small>⏳ to claim · ${pending.length}</small></button>
      <button class="card tile ${sfilter === 'submitted' ? 'sel' : ''}" data-s="submitted"><b>${totals(submitted) || submitted.length}</b><small>📨 awaiting · ${submitted.length}</small></button>
      <button class="card tile ${sfilter === 'paid' ? 'sel' : ''}" data-s="paid"><b>${totals(paidYear, 'reimbPaidAmount') || paidYear.length}</b><small>✅ received ${year}</small></button>
    </div>
    ${due.length ? `<div class="card warnbox">⏰ Claim deadline coming up: ${due.map(d => { const n = deadlineIn(d); return `<a href="#/d/${d.id}">${esc(d.title)} (${n < 0 ? 'overdue' : n === 0 ? 'today' : `in ${n}d`})</a>`; }).join(', ')}</div>` : ''}
    <div class="chips">${[['open', 'Open'], ...Object.entries(RSTATUS).map(([k, v]) => [k, `${v.e} ${v.l}`]), ['all', 'All']].map(([k, l]) =>
      `<button class="chip ${sfilter === k ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
    ${froms.length > 1 ? `<div class="chips"><button class="chip ${!ffilter ? 'on' : ''}" data-f="">Anyone</button>${froms.map(f => `<button class="chip ${ffilter === f ? 'on' : ''}" data-f="${esc(f)}">${esc(f)}</button>`).join('')}</div>` : ''}
    <div id="rlist"></div>
    <a class="fab" href="#/d/new?reimb=1" aria-label="Add a purchase to claim">＋</a>`;

  const list = all.filter(d => (sfilter === 'all' || (sfilter === 'open' ? ['pending', 'submitted'].includes(d.reimbStatus) : d.reimbStatus === sfilter)) && (!ffilter || d.reimbFrom === ffilter));
  $('#rlist').innerHTML = list.length ? `
    <p class="row small muted"><span class="grow">${list.length} item${list.length > 1 ? 's' : ''}${totals(list) ? ' · ' + totals(list) : ''}</span><button class="btn ghost" id="r-csv">⬇ CSV</button></p>
    ${list.map(d => {
      const n = deadlineIn(d);
      const paidDiff = d.reimbStatus === 'paid' && d.reimbPaidAmount != null && d.amount && +d.reimbPaidAmount !== +d.amount;
      return `<a class="card rcard" href="#/d/${d.id}">
        <div class="row">${d.files?.[0]?.t ? `<img class="dthumb" data-fid="${esc(d.files[0].t)}" alt="">` : `<span class="dthumb">${(DTYPES[d.type] || DTYPES.other).e}</span>`}
          <div class="grow"><b>${esc(d.title || 'Untitled')}</b>
            <div class="small muted">${d.reimbFrom ? 'from ' + esc(d.reimbFrom) + ' · ' : ''}${fmtDate(d.date)}</div>
            <div class="small">${statusBadge(d)}
              ${d.reimbStatus === 'submitted' && d.reimbSubmittedOn ? ` <span class="muted">since ${fmtDate(d.reimbSubmittedOn)}${d.reimbRef ? ' · #' + esc(d.reimbRef) : ''}</span>` : ''}
              ${d.reimbStatus === 'paid' && d.reimbPaidOn ? ` <span class="muted">${fmtDate(d.reimbPaidOn)}${paidDiff ? ' · got ' + fmtMoney(d.reimbPaidAmount, docSym(d)) : ''}</span>` : ''}
              ${n !== null ? ` <span class="${n <= 14 ? 'warn' : 'muted'}">⏰ ${n < 0 ? 'deadline passed' : 'claim by ' + fmtDate(d.reimbDeadline)}</span>` : ''}</div></div>
          ${d.amount ? `<b class="amt">${fmtMoney(d.amount, docSym(d))}</b>` : ''}</div>
        <div class="row ractions">${claimActions(d)}</div></a>`;
    }).join('')}`
    : `<div class="empty">${all.length ? 'Nothing in this view.' : 'No purchases to claim yet.<br>Tap ＋ and snap the receipt, or open any bill in Docs and tick “I need to claim this back”.'}</div>`;

  $$('[data-s]', view).forEach(b => b.onclick = () => { sfilter = b.dataset.s; reimbList(view); });
  $$('[data-f]', view).forEach(b => b.onclick = () => { ffilter = b.dataset.f; reimbList(view); });
  wireClaimActions(view, () => reimbList(view));
  $('#r-csv')?.addEventListener('click', () => {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Title', 'Vendor', 'Amount', 'Currency', 'Claim from', 'Status', 'Submitted on', 'Reference', 'Received on', 'Amount received', 'Notes'],
      ...list.map(d => [d.date, d.title, d.vendor, d.amount, d.currency || docSym(d).trim(), d.reimbFrom, RSTATUS[d.reimbStatus]?.l, d.reimbSubmittedOn, d.reimbRef, d.reimbPaidOn, d.reimbPaidAmount, d.notes])];
    download(`reimbursements-${today()}.csv`, rows.map(r => r.map(cell).join(',')).join('\n'), 'text/csv');
  });
  hydrate(view);
}

// Small summary card used on the Docs list and Home.
// With `always`, shows a quiet link even when nothing is open (so the page stays reachable).
export function claimsSummaryCard(always = false) {
  const open = openClaims();
  if (!open.length) return always ? `<a class="card row" href="#/reimb">💸 <span class="grow"><b>Reimbursements</b><br><small class="muted">${claims().length ? 'All claims settled 🎉' : 'Track purchases you need to claim back'}</small></span><span class="muted">›</span></a>` : '';
  const p = open.filter(d => d.reimbStatus === 'pending'), s = open.filter(d => d.reimbStatus === 'submitted');
  const parts = [p.length && `${p.length} to claim${totals(p) ? ' (' + totals(p) + ')' : ''}`, s.length && `${s.length} awaiting payment`].filter(Boolean);
  return `<a class="card row" href="#/reimb">💸 <span class="grow"><b>Reimbursements</b><br><small class="muted">${parts.join(' · ')}</small></span><span class="muted">›</span></a>`;
}
