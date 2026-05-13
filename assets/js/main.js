(() => {
  const form = document.getElementById('notify-form');
  const status = document.getElementById('form-status');
  if (!form || !status) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim();
    if (!email || !form.elements.email.checkValidity()) {
      status.textContent = 'Please enter a valid email.';
      return;
    }
    form.reset();
    status.textContent = "Thanks — we'll be in touch.";
  });
})();
