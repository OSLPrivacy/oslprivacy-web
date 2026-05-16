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

  const subscribeBtn = document.querySelector('.cta-subscribe');
  const checkoutStatus = document.getElementById('checkout-status');
  if (subscribeBtn) {
    subscribeBtn.addEventListener('click', async () => {
      const yearly = document.querySelector('input[name="period"][value="yearly"]');
      const plan = yearly && yearly.checked ? 'yearly' : 'monthly';
      const label = subscribeBtn.textContent;
      subscribeBtn.disabled = true;
      subscribeBtn.textContent = 'Connecting...';
      if (checkoutStatus) checkoutStatus.textContent = '';

      const fail = (msg) => {
        if (checkoutStatus) checkoutStatus.textContent = msg;
        subscribeBtn.disabled = false;
        subscribeBtn.textContent = label;
      };

      try {
        const res = await fetch('https://keyserver.oslprivacy.com/v1/checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.url) {
            window.location.href = data.url;
            return;
          }
          fail("Couldn't reach the payment server. Try again in a moment, or email OSLPrivacy@gmail.com.");
          return;
        }
        if (res.status === 503) {
          fail("Subscriptions aren't available right now. Email OSLPrivacy@gmail.com.");
        } else {
          fail("Couldn't reach the payment server. Try again in a moment, or email OSLPrivacy@gmail.com.");
        }
      } catch (err) {
        fail("Couldn't reach the payment server. Try again in a moment, or email OSLPrivacy@gmail.com.");
      }
    });
  }
})();
