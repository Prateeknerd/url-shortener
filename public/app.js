const form = document.querySelector('#shorten-form');
const input = document.querySelector('#url');
const titleInput = document.querySelector('#title');
const result = document.querySelector('#result');
const shortLink = document.querySelector('#short-link');
const error = document.querySelector('#error');
const submit = document.querySelector('#submit-button');
const copyButton = document.querySelector('#copy-button');
const linksList = document.querySelector('#links-list');
const refreshButton = document.querySelector('#refresh-button');

function formatVisit(value) {
  return value ? `Last visit ${new Date(value).toLocaleDateString()}` : 'No visits yet';
}

async function copyLink(url, button) {
  try {
    await navigator.clipboard.writeText(url);
    const previous = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = previous; }, 1800);
  } catch {
    error.textContent = 'Could not copy. Select the link to copy it.';
    error.hidden = false;
  }
}

function renderLinks(links) {
  const clicks = links.reduce((sum, link) => sum + link.clicks, 0);
  document.querySelector('#total-links').textContent = links.length.toLocaleString();
  document.querySelector('#total-clicks').textContent = clicks.toLocaleString();
  document.querySelector('#top-clicks').textContent = links.reduce((max, link) => Math.max(max, link.clicks), 0).toLocaleString();
  document.querySelector('#link-count').textContent = `${links.length} ${links.length === 1 ? 'link' : 'links'}`;
  linksList.replaceChildren();

  if (!links.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No links yet. Create one above to get started.';
    linksList.append(empty);
    return;
  }

  for (const item of links) {
    const row = document.createElement('div');
    row.className = 'link-item';
    const main = document.createElement('div');
    main.className = 'link-main';
    const title = document.createElement('strong');
    title.className = 'link-title';
    title.textContent = item.title;
    const link = document.createElement('a');
    link.className = 'link-short';
    link.href = item.shortUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = item.shortUrl;
    const original = document.createElement('div');
    original.className = 'link-original';
    original.textContent = item.originalUrl;
    original.title = item.originalUrl;
    main.append(title, link, original);

    const meta = document.createElement('div');
    meta.className = 'link-meta';
    const count = document.createElement('div');
    count.className = 'click-count';
    const number = document.createElement('strong');
    number.textContent = item.clicks.toLocaleString();
    const label = document.createElement('span');
    label.textContent = 'clicks';
    count.append(number, label);
    const visit = document.createElement('span');
    visit.className = 'last-visit';
    visit.textContent = formatVisit(item.lastClickedAt);
    const copy = document.createElement('button');
    copy.className = 'link-copy';
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => copyLink(item.shortUrl, copy));
    const edit = document.createElement('button');
    edit.className = 'link-edit';
    edit.type = 'button';
    edit.textContent = 'Edit title';
    edit.addEventListener('click', () => {
      if (main.querySelector('.edit-form')) return;
      const editForm = document.createElement('form');
      editForm.className = 'edit-form';
      const field = document.createElement('input');
      field.type = 'text';
      field.value = item.title;
      field.maxLength = 80;
      field.required = true;
      field.setAttribute('aria-label', 'Link title');
      const save = document.createElement('button');
      save.type = 'submit';
      save.textContent = 'Save';
      editForm.append(field, save);
      editForm.addEventListener('submit', async event => {
        event.preventDefault();
        save.disabled = true;
        try {
          const response = await fetch(`/api/links/${item.code}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: field.value }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Could not save title.');
          await loadAnalytics();
        } catch (cause) {
          save.disabled = false;
          field.setCustomValidity(cause.message);
          field.reportValidity();
          field.addEventListener('input', () => field.setCustomValidity(''), { once: true });
        }
      });
      main.insertBefore(editForm, link);
      field.focus();
      field.select();
    });
    meta.append(count, visit, edit, copy);
    row.append(main, meta);
    linksList.append(row);
  }
}

async function loadAnalytics() {
  try {
    const response = await fetch('/api/links');
    if (response.status === 401) { location.replace('/login'); return; }
    if (!response.ok) throw new Error('Could not load analytics.');
    const data = await response.json();
    renderLinks(data.links);
  } catch {
    linksList.replaceChildren();
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = 'Could not load analytics. Try refreshing.';
    linksList.append(message);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.hidden = true;
  result.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Shortening...';
  try {
    const response = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input.value, title: titleInput.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not shorten this URL.');
    shortLink.href = data.shortUrl;
    shortLink.textContent = data.shortUrl;
    result.hidden = false;
    titleInput.value = '';
    await loadAnalytics();
  } catch (cause) {
    error.textContent = cause.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Shorten <span aria-hidden="true">→</span>';
  }
});

copyButton.addEventListener('click', () => copyLink(shortLink.href, copyButton));
refreshButton.addEventListener('click', loadAnalytics);
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.replace('/login');
});
window.addEventListener('focus', loadAnalytics);
setInterval(() => { if (!document.hidden && !document.querySelector('.edit-form')) loadAnalytics(); }, 15000);
fetch('/api/auth/me').then(async response => {
  if (!response.ok) { location.replace('/login'); return; }
  const data = await response.json();
  document.querySelector('#account-email').textContent = data.user.email;
  loadAnalytics();
}).catch(() => location.replace('/login'));
