// Shows signed-in links in the header when the visitor has a session
const nav = document.getElementById('site-nav');

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
