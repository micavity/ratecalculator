// The admin page. Served by the Worker (not as a static file) so only
// admins can load it.
export function renderAdminPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Admin · CreatorGG</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/">Creator<span class="gg">GG</span></a>
      <nav class="site-nav" aria-label="Main"><a href="/dashboard/">Dashboard</a><span class="plan-pill admin-pill">Admin</span></nav>
    </div>
  </header>

  <main class="wrap admin">
    <p class="alert" id="banner" hidden></p>
    <section class="admin-stats" id="stats"></section>

    <section class="panel">
      <h2>Affiliate payouts</h2>
      <p class="small muted">Send each affiliate their available balance through PayPal, then click "Mark as paid". Earnings are held for 30 days to cover refunds.</p>
      <div id="payouts"></div>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Creators</h2>
        <form id="search" class="admin-search">
          <input type="search" name="q" placeholder="Search name, kit link or platform username" aria-label="Search creators">
          <button type="submit">Search</button>
        </form>
      </div>
      <div id="results"></div>
      <div class="actions">
        <button type="button" class="button-secondary" id="prev">← Newer</button>
        <button type="button" class="button-secondary" id="next">Older →</button>
      </div>
    </section>
  </main>

  <script type="module">
    const banner = document.getElementById('banner');
    const results = document.getElementById('results');
    const number = new Intl.NumberFormat('en-US');
    const PLAN_NAMES = { free: 'Free', essential: 'Essential', pro: 'Pro', ultra: 'Ultra' };
    let query = '';
    let page = 0;

    function el(tag, attrs = {}, children = []) {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value);
      }
      node.append(...children);
      return node;
    }

    function showBanner(text, kind = 'error') {
      banner.textContent = text;
      banner.className = 'alert alert-' + kind;
      banner.hidden = false;
      setTimeout(() => { banner.hidden = true; }, 4000);
    }

    async function api(path, options = {}) {
      const res = await fetch(path, { ...options, headers: options.body ? { 'content-type': 'application/json' } : {} });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    }

    function planText(plan) {
      if (plan.plan === 'free') return 'Free';
      const source = plan.source === 'gift' ? 'gifted' : plan.source || '';
      const until = plan.expires ? 'until ' + new Date(plan.expires).toLocaleDateString() : 'lifetime';
      return PLAN_NAMES[plan.plan] + ' · ' + source + ' · ' + until;
    }

    async function loadStats() {
      const s = await api('/api/admin/stats');
      const paid = s.plans.filter((p) => p.source === 'paid').reduce((n, p) => n + p.count, 0);
      const gifted = s.plans.filter((p) => p.source === 'gift').reduce((n, p) => n + p.count, 0);
      const byPlan = s.plans.map((p) => PLAN_NAMES[p.plan] + ' (' + (p.source || 'other') + '): ' + p.count).join(' · ') || 'None yet';
      const card = (value, label) => el('div', { class: 'stat' }, [el('span', { class: 'stat-value', text: number.format(value) }), el('span', { class: 'stat-label', text: label })]);
      document.getElementById('stats').replaceChildren(
        card(s.creators, 'Creators'),
        card(s.signupsWeek, 'Signups this week'),
        card(s.signupsMonth, 'Signups this month'),
        card(paid, 'Paying subscribers'),
        card(gifted, 'Gifted plans'),
        card(s.founding, 'Founding creators'),
        card(s.kitViews30, 'Kit views (30 days)'),
        el('p', { class: 'small muted admin-plans', text: 'Active plans: ' + byPlan }),
      );
    }

    function creatorRow(u) {
      const planSelect = el('select', { 'aria-label': 'Plan' }, ['essential', 'pro', 'ultra', 'free'].map((p) => el('option', { value: p, text: p === 'free' ? 'Free (remove gift)' : PLAN_NAMES[p] })));
      planSelect.value = u.plan.plan === 'free' ? 'essential' : u.plan.plan;
      const lengthSelect = el('select', { 'aria-label': 'Length' }, [
        el('option', { value: '', text: 'Lifetime' }),
        el('option', { value: '1', text: '1 month' }),
        el('option', { value: '3', text: '3 months' }),
        el('option', { value: '12', text: '12 months' }),
      ]);
      const apply = el('button', { type: 'button', text: 'Apply' });
      const planLabel = el('p', { class: 'small', text: planText(u.plan) });
      apply.addEventListener('click', async () => {
        const plan = planSelect.value;
        const verb = plan === 'free' ? 'Remove the plan from' : 'Gift ' + PLAN_NAMES[plan] + ' (' + (lengthSelect.selectedOptions[0].text.toLowerCase()) + ') to';
        if (!confirm(verb + ' ' + u.displayName + '?')) return;
        try {
          const data = await api('/api/admin/users/' + u.id + '/plan', {
            method: 'POST',
            body: JSON.stringify({ plan, months: lengthSelect.value ? Number(lengthSelect.value) : null }),
          });
          planLabel.textContent = planText(data.plan);
          showBanner('Updated ' + u.displayName + '.', 'success');
          loadStats();
        } catch (err) {
          showBanner(err.message);
        }
      });

      const founding = el('input', { type: 'checkbox' });
      founding.checked = u.plan.founding;
      founding.addEventListener('change', async () => {
        try {
          await api('/api/admin/users/' + u.id + '/founding', { method: 'POST', body: JSON.stringify({ founding: founding.checked }) });
          showBanner((founding.checked ? 'Added' : 'Removed') + ' Founding Creator badge.', 'success');
          loadStats();
        } catch (err) {
          founding.checked = !founding.checked;
          showBanner(err.message);
        }
      });

      const platforms = u.platforms.map((p) => p.provider + ': ' + p.username).join(' · ') || 'No linked platforms';
      return el('div', { class: 'admin-row' }, [
        el('div', {}, [
          el('a', { href: '/' + u.slug, target: '_blank', rel: 'noopener' }, [el('strong', { text: u.displayName })]),
          el('span', { class: 'muted', text: ' /' + u.slug }),
          el('p', { class: 'small muted', text: platforms }),
          el('p', { class: 'small muted', text: 'Joined ' + new Date(u.createdAt).toLocaleDateString() + ' · ' + number.format(u.views30) + ' kit views (30 days) · ID ' + u.id }),
          planLabel,
        ]),
        el('div', { class: 'admin-actions' }, [
          planSelect, lengthSelect, apply,
          el('label', { class: 'toggle' }, [founding, document.createTextNode('Founding Creator')]),
        ]),
      ]);
    }

    async function loadUsers() {
      try {
        const data = await api('/api/admin/users?q=' + encodeURIComponent(query) + '&page=' + page);
        results.replaceChildren(...(data.users.length ? data.users.map(creatorRow) : [el('p', { class: 'muted', text: 'No creators found.' })]));
        document.getElementById('prev').disabled = page === 0;
        document.getElementById('next').disabled = !data.hasMore;
      } catch (err) {
        showBanner(err.message);
      }
    }

    document.getElementById('search').addEventListener('submit', (event) => {
      event.preventDefault();
      query = event.target.elements.q.value.trim();
      page = 0;
      loadUsers();
    });
    document.getElementById('prev').addEventListener('click', () => { page = Math.max(0, page - 1); loadUsers(); });
    document.getElementById('next').addEventListener('click', () => { page += 1; loadUsers(); });

    const money = (cents) => '$' + (cents / 100).toFixed(2);

    async function loadPayouts() {
      const data = await api('/api/admin/payouts');
      const box = document.getElementById('payouts');
      if (!data.affiliates.length) {
        box.replaceChildren(el('p', { class: 'muted', text: 'No affiliate earnings yet.' }));
        return;
      }
      box.replaceChildren(...data.affiliates.map((a) => {
        const ready = a.availableCents >= data.minPayoutCents;
        const pay = el('button', { type: 'button', text: 'Mark ' + money(a.availableCents) + ' as paid' });
        pay.disabled = !a.availableCents;
        pay.addEventListener('click', async () => {
          if (!a.payoutEmail && !confirm(a.displayName + " hasn't added a PayPal email. Mark as paid anyway?")) return;
          if (!confirm('Have you sent ' + money(a.availableCents) + ' to ' + (a.payoutEmail || a.displayName) + '? This marks it as paid.')) return;
          try {
            const result = await api('/api/admin/payouts/' + a.id + '/paid', { method: 'POST' });
            showBanner('Marked ' + money(result.paidCents) + ' as paid.', 'success');
            loadPayouts();
          } catch (err) {
            showBanner(err.message);
          }
        });
        return el('div', { class: 'admin-row' }, [
          el('div', {}, [
            el('a', { href: '/' + a.slug, target: '_blank', rel: 'noopener' }, [el('strong', { text: a.displayName })]),
            el('span', { class: 'muted', text: ' · code ' + (a.code || '—') }),
            el('p', { class: 'small', text: 'PayPal: ' + (a.payoutEmail || 'not added yet') }),
            el('p', { class: 'small muted', text: 'Available ' + money(a.availableCents) + ' · Held ' + money(a.heldCents) + ' · Paid so far ' + money(a.paidCents) }),
            ready ? el('p', { class: 'small opened', text: 'Ready to pay out' }) : el('p', { class: 'small muted', text: 'Below the ' + money(data.minPayoutCents) + ' minimum' }),
          ]),
          el('div', { class: 'admin-actions' }, [pay]),
        ]);
      }));
    }

    loadPayouts().catch((err) => showBanner(err.message));
    loadStats().catch((err) => showBanner(err.message));
    loadUsers();
  </script>
</body>
</html>`;
}
