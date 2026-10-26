// Shows signed-in links in the header when the visitor has a session
const nav = document.getElementById('site-nav');

// Remember a referral code (?ref=CODE) for 30 days so it's credited at sign-up.
// The first code wins.
const ref = new URLSearchParams(location.search).get('ref');
if (ref && /^[A-Za-z0-9]{3,16}$/.test(ref) && !document.cookie.split('; ').some((c) => c.startsWith('cgg_ref='))) {
  document.cookie = `cgg_ref=${ref.toUpperCase()}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`;
}

function link(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  if (location.pathname === href) a.setAttribute('aria-current', 'page');
  return a;
}

if (nav) {
  fetch('/api/session')
    .then((res) => res.json())
    .then((data) => {
      if (!data.signedIn) return;
      const logout = document.createElement('button');
      logout.type = 'button';
      logout.className = 'button-link';
      logout.textContent = 'Log out';
      logout.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        location.href = '/';
      });
      nav.replaceChildren(
        link('/', 'Rate calculator'),
        link('/dashboard/', 'Dashboard'),
        link(`/${data.slug}`, 'My kit'),
        logout,
      );
    })
    .catch(() => {});
}
