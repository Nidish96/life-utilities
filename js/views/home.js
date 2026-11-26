import { live, get } from '../state.js';
import { $, $$, esc, setTitle, avatarHtml, daysUntil, daysFromToday, fmtDate, photoImg, hydrate, shuffle, go } from '../ui.js';
import { renderCapture } from './capture.js';
import { askCard, bindAskCard } from './ask.js';
import { myHome, homeHouse, homeAlerts } from './myhome.js';
import { claimsSummaryCard, openClaims, deadlineIn } from './reimb.js';
import { INTENTS, setRerender, editMemory } from './people.js';

export function home(view) {
  setTitle('Life Utilities');
  setRerender(() => home(view));
  const people = live('people');
  const bdays = people.map(p => ({ p, d: daysUntil(p.birthday) })).filter(x => x.d !== null && x.d <= 45).sort((a, b) => a.d - b.d);
  const mems = live('memories').filter(m => m.photos?.length).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
  const warr = live('documents').filter(d => { const n = daysFromToday(d.warrantyUntil); return n !== null && n >= 0 && n <= 60; });
  const follow = live('documents').filter(d => { const n = daysFromToday(d.followUp); return n !== null && n >= 0 && n <= 14; });
  const claimDue = openClaims().filter(d => { const n = deadlineIn(d); return n !== null && n <= 14; });
  const claimCard = claimsSummaryCard();
  const alerts = homeAlerts(), mh = homeHouse();
  const houses = live('houses').filter(h => !['rejected'].includes(h.status));
  const hr = new Date().getHours();

  view.innerHTML = `
    <h2 class="hello">${hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'} 👋</h2>
    ${askCard()}
    ${mh ? `<a class="card row" href="#/myhome">🏡 <span class="grow"><b>My home</b><br><small class="muted">${esc(mh.title)}</small></span><span class="muted">›</span></a>` : ''}
    <div id="home-cap"></div>
    ${bdays.length ? `<h3 class="section">Coming up</h3><div class="hscroll">${bdays.map(({ p, d }) => `
      <a class="card mini" href="#/p/${p.id}/plan?i=birthday">${avatarHtml(p, 40)}<b>${esc(p.name.split(' ')[0])}</b><small>🎂 ${d === 0 ? 'Today!' : `in ${d}d`}</small></a>`).join('')}</div>` : ''}
    ${people.length ? `
    <h3 class="section">Quick spin</h3>
    <div class="card">
      <div class="row"><select id="spin-p" class="grow">${people.sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <button class="btn" id="spin-rand" title="Random person">🎲</button></div>
      <div class="chips">${Object.entries(INTENTS).map(([k, v]) => `<button class="chip" data-i="${k}">${v.e} ${v.l}</button>`).join('')}<button class="chip" id="spin-watch">🍿 Watch</button></div>
    </div>` : ''}
    ${warr.length || follow.length || claimCard || alerts.length ? `<h3 class="section">Heads up</h3>
      ${alerts.map(a => `<a class="card row" href="#/myhome">${a.e} <span class="grow">${esc(a.t)}</span><small class="${a.warn ? 'warn' : ''}">${esc(a.s)}</small></a>`).join('')}
      ${claimDue.map(d => { const n = deadlineIn(d); return `<a class="card row" href="#/d/${d.id}">⏰ <span class="grow">Claim ${esc(d.title)}</span><small>${n < 0 ? 'deadline passed' : n === 0 ? 'due today' : 'by ' + fmtDate(d.reimbDeadline)}</small></a>`; }).join('')}
      ${claimCard}
      ${warr.map(d => `<a class="card row" href="#/d/${d.id}">🛡️ <span class="grow">${esc(d.title)}</span><small>warranty ends ${fmtDate(d.warrantyUntil)}</small></a>`).join('')}
      ${follow.map(d => `<a class="card row" href="#/d/${d.id}">🩺 <span class="grow">${esc(d.title)}</span><small>follow-up ${fmtDate(d.followUp)}</small></a>`).join('')}` : ''}
    ${mems.length ? `<h3 class="section">Memories</h3><div class="hscroll">${mems.map(m => `<button class="memthumb" data-mem="${m.id}">${photoImg(m.photos[0], 'mt')}<small>${esc(m.title || fmtDate(m.date))}</small></button>`).join('')}</div>` : ''}
    <div class="tiles">
      <a class="card tile" href="#/people"><b>${people.length}</b><small>people</small></a>
      <a class="card tile" href="#/houses"><b>${houses.length}</b><small>houses in play</small></a>
      <a class="card tile" href="#/docs"><b>${live('documents').length}</b><small>bills & docs</small></a>
      <a class="card tile" href="#/watch"><b>${live('watch').filter(w => w.status !== 'watched').length}</b><small>🍿 to watch</small></a>
    </div>`;
  renderCapture($('#home-cap'), { onSaved: () => {} });
  bindAskCard(view);
  $('#spin-rand')?.addEventListener('click', () => { const s = $('#spin-p'); s.selectedIndex = Math.floor(Math.random() * s.options.length); });
  $('#spin-watch')?.addEventListener('click', () => go(`#/watch?with=${$('#spin-p').value}`));
  $$('[data-i]', view).forEach(b => b.onclick = () => go(`#/p/${$('#spin-p').value}/plan?i=${b.dataset.i}`));
  $$('[data-mem]', view).forEach(b => b.onclick = () => editMemory(get('memories', b.dataset.mem)));
  hydrate(view);
}
