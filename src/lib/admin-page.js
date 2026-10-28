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
      <h2>Reviews</h2>
      <p class="small muted">Every review creators leave. The average counts all of them. "Approve" marks a review that may be shown on the site later; only creators who ticked "OK to show" can be approved. Approve to remove spam or personal info, not to hide low ratings.</p>
      <div class="admin-stats" id="reviewTotals"></div>
      <div id="reviews"></div>
    </section>

    <section class="panel">
      <h2>Affiliates</h2>
      <p class="small muted">Everyone who has referred a creator. Earnings are held for 30 days to cover refunds. To pay someone, send their available balance through PayPal, then click "Mark as paid". Use "Show referrals" to see who each affiliate brought in.</p>
      <div class="admin-stats" id="affiliateTotals"></div>
      <div id="affiliates"></div>
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

    const statCard = (value, label) => el('div', { class: 'stat' }, [el('span', { class: 'stat-value', text: value }), el('span', { class: 'stat-label', text: label })]);

    async function toggleReferred(a, box, button) {
      if (!box.hidden) {
        box.hidden = true;
        button.textContent = 'Show referrals';
        return;
      }
      button.textContent = 'Loading…';
      try {
        const data = await api('/api/admin/affiliates/' + a.id);
        box.replaceChildren(...(data.referred.length ? data.referred.map((r) => {
          const status = r.subscriptionStatus === 'active' ? 'subscribed'
            : r.subscriptionStatus === 'past_due' ? 'payment failing'
            : r.firstPaidAt ? 'paid before, not subscribed now'
            : 'not paying yet';
          return el('div', { class: 'referred-row' }, [
            el('div', {}, [
              el('a', { href: '/' + r.slug, target: '_blank', rel: 'noopener' }, [el('strong', { text: r.displayName })]),
              el('span', { class: 'muted', text: ' /' + r.slug }),
              el('p', { class: 'small muted', text: 'Joined ' + new Date(r.joinedAt).toLocaleDateString() + ' · ' + planText(r.plan) + ' · ' + status }),
            ]),
            el('div', { class: 'small referred-money' }, [
              el('span', { text: 'Paid ' + money(r.revenueCents) }),
              el('span', { class: 'muted', text: 'Commission ' + money(r.commissionCents) }),
            ]),
          ]);
        }) : [el('p', { class: 'small muted', text: 'No referred creators yet.' })]));
        box.hidden = false;
        button.textContent = 'Hide referrals';
      } catch (err) {
        button.textContent = 'Show referrals';
        showBanner(err.message);
      }
    }

    async function loadAffiliates() {
      const data = await api('/api/admin/affiliates');
      const t = data.totals;
      document.getElementById('affiliateTotals').replaceChildren(
        statCard(number.format(data.affiliates.length), 'Affiliates'),
        statCard(number.format(t.signups), 'Referred sign-ups'),
        statCard(number.format(t.paying), 'Became paying'),
        statCard(number.format(t.subscribed), 'Subscribed now'),
        statCard(money(t.revenueCents), 'Revenue from referrals'),
        statCard(money(t.availableCents), 'Owed now'),
        statCard(money(t.heldCents), 'Held (30 days)'),
        statCard(money(t.paidCents), 'Paid out'),
      );
      const box = document.getElementById('affiliates');
      if (!data.affiliates.length) {
        box.replaceChildren(el('p', { class: 'muted', text: 'No referrals yet.' }));
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
            loadAffiliates();
          } catch (err) {
            showBanner(err.message);
          }
        });
        const referredBox = el('div', { class: 'referred-list' });
        referredBox.hidden = true;
        const toggle = el('button', { type: 'button', class: 'button-secondary', text: 'Show referrals' });
        toggle.addEventListener('click', () => toggleReferred(a, referredBox, toggle));
        return el('div', { class: 'affiliate' }, [
          el('div', { class: 'admin-row' }, [
            el('div', {}, [
              el('a', { href: '/' + a.slug, target: '_blank', rel: 'noopener' }, [el('strong', { text: a.displayName })]),
              el('span', { class: 'muted', text: ' · code ' + (a.code || '—') }),
              el('p', { class: 'small', text: a.signups + ' sign-ups · ' + a.paying + ' became paying · ' + a.subscribed + ' subscribed now · ' + money(a.revenueCents) + ' revenue' }),
              el('p', { class: 'small muted', text: 'Earnings: ' + money(a.availableCents) + ' available · ' + money(a.heldCents) + ' held · ' + money(a.paidCents) + ' paid' }),
              el('p', { class: 'small muted', text: 'PayPal: ' + (a.payoutEmail || 'not added yet') }),
              ready ? el('p', { class: 'small opened', text: 'Ready to pay out' }) : el('p', { class: 'small muted', text: a.availableCents ? 'Below the ' + money(data.minPayoutCents) + ' minimum' : 'Nothing to pay yet' }),
            ]),
            el('div', { class: 'admin-actions' }, [toggle, pay]),
          ]),
          referredBox,
        ]);
      }));
    }

    async function loadReviews() {
      const data = await api('/api/admin/reviews');
      document.getElementById('reviewTotals').replaceChildren(
        statCard(number.format(data.count), 'Reviews'),
        statCard(data.average !== null ? '★ ' + data.average : '–', 'Average rating (all reviews)'),
      );
      const box = document.getElementById('reviews');
      if (!data.reviews.length) {
        box.replaceChildren(el('p', { class: 'muted', text: 'No reviews yet. Creators are asked 14 days after they start using CreatorGG.' }));
        return;
      }
      box.replaceChildren(...data.reviews.map((r) => {
        const approve = el('button', { type: 'button', class: r.approved ? 'button-secondary' : '', text: r.approved ? 'Approved ✓ (undo)' : 'Approve' });
        approve.disabled = !r.publicOk;
        approve.addEventListener('click', async () => {
          try {
            await api('/api/admin/reviews/' + r.id + '/approve', { method: 'POST', body: JSON.stringify({ approved: !r.approved }) });
            loadReviews();
          } catch (err) {
            showBanner(err.message);
          }
        });
        return el('div', { class: 'admin-row' }, [
          el('div', {}, [
            el('p', {}, [el('strong', { text: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) + ' ' }), el('a', { href: '/' + r.slug, target: '_blank', rel: 'noopener', text: r.displayName })]),
            r.comment ? el('p', { class: 'small', text: '“' + r.comment + '”' }) : el('p', { class: 'small muted', text: 'No comment' }),
            el('p', { class: 'small muted', text: new Date(r.createdAt).toLocaleDateString() + ' · ' + (r.publicOk ? 'OK to show publicly' : 'Private feedback only') }),
          ]),
          el('div', { class: 'admin-actions' }, [approve]),
        ]);
      }));
    }

    loadReviews().catch((err) => showBanner(err.message));
    loadAffiliates().catch((err) => showBanner(err.message));
    loadStats().catch((err) => showBanner(err.message));
    loadUsers();
  </script>
</body>
</html>`;
}
