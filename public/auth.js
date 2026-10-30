const register = location.pathname === '/register';
const title = document.querySelector('#auth-title');
const description = document.querySelector('#auth-description');
const form = document.querySelector('#auth-form');
const password = document.querySelector('#password');
const submit = document.querySelector('#auth-submit');
const error = document.querySelector('#auth-error');
const switcher = document.querySelector('#auth-switch');

if (register) {
  document.title = 'Create account · URL Shortener';
  title.textContent = 'Create an account';
  description.textContent = 'Save your links and see their clicks.';
  password.autocomplete = 'new-password';
  submit.textContent = 'Create account';
  switcher.replaceChildren('Already have an account? ');
  const link = document.createElement('a');
  link.href = '/login';
  link.textContent = 'Log in';
  switcher.append(link);
}

fetch('/api/auth/me').then(response => { if (response.ok) location.replace('/'); });

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.hidden = true;
  submit.disabled = true;
  try {
    const response = await fetch(register ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.querySelector('#email').value, password: password.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not continue.');
    location.replace('/');
  } catch (cause) {
    error.textContent = cause.message;
    error.hidden = false;
    submit.disabled = false;
  }
});
