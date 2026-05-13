(() => {
  const form = document.getElementById('notify-form');
  const status = document.getElementById('form-status');
  if (form && status) {
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
  }

  const toggle = document.querySelector('.topnav-toggle');
  const menu = document.getElementById('topnav-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      menu.classList.toggle('open');
    });
  }
})();
