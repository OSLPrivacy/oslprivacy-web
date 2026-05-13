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

  const periodInputs = document.querySelectorAll('input[name="period"]');
  if (periodInputs.length) {
    const setPeriod = (period) => {
      document.querySelectorAll('[data-monthly][data-yearly]').forEach((el) => {
        el.textContent = el.dataset[period];
      });
      document.querySelectorAll('[data-monthly-text][data-yearly-text]').forEach((el) => {
        el.textContent = el.dataset[period + 'Text'];
      });
      const url = new URL(window.location);
      if (period === 'yearly') url.searchParams.set('period', 'yearly');
      else url.searchParams.delete('period');
      history.replaceState(null, '', url);
    };

    const urlPeriod = new URLSearchParams(window.location.search).get('period');
    if (urlPeriod === 'yearly') {
      const yearly = document.querySelector('input[name="period"][value="yearly"]');
      if (yearly) yearly.checked = true;
      setPeriod('yearly');
    }

    periodInputs.forEach((input) => {
      input.addEventListener('change', (e) => {
        if (e.target.checked) setPeriod(e.target.value);
      });
    });
  }
})();
