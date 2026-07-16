(() => {
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });
      revealEls.forEach((el) => io.observe(el));
    } else {
      revealEls.forEach((el) => el.classList.add('is-visible'));
    }
  }

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

  const regModal = document.getElementById('reg-modal');
  if (regModal) {
    // Hand-curated, not fetched: there is no live API for "chat control laws
    // by country." These are real, publicly reported laws/proposals we have
    // solid knowledge of, reframed around what they actually mean for you —
    // status changes fast, and "not law yet" is not the same as "safe," but
    // it's also not the same as "already happening." See the disclaimer.
    const REGULATIONS = {
      europe: [
        {
          place: 'European Union',
          name: 'The EU wants to scan every message you send',
          status: 'proposed',
          statusLabel: 'Not law yet',
          date: 'Pushed since 2022 — still being fought over',
          desc: "Brussels keeps trying to pass a law that would force apps to scan your private chats before you even hit send — yes, the encrypted ones too. It's been rewritten and delayed again and again because of the backlash, but it hasn't gone away.",
        },
        {
          place: 'United Kingdom',
          name: 'The UK can already order apps to read your chats',
          status: 'enacted',
          statusLabel: 'Already law',
          date: 'On the books since October 2023',
          desc: 'This one\'s real: the regulator Ofcom can legally order messaging apps to scan what you type, encrypted or not, whenever the government decides it\'s "feasible." Signal and WhatsApp both said they\'d rather pull out of the UK than build that door in.',
        },
      ],
      namerica: [
        {
          place: 'United States',
          name: 'US lawmakers keep trying to kill your encryption',
          status: 'proposed',
          statusLabel: 'Not law yet',
          date: 'Brought back in 2020, 2022, and 2023',
          desc: "Congress keeps reintroducing a bill that would punish any app that doesn't let the government see inside your messages. It's died every time so far — but it keeps coming back, and it only has to pass once.",
        },
      ],
      apac: [
        {
          place: 'India',
          name: 'India can already demand to know who sent a message',
          status: 'enacted',
          statusLabel: 'Already law',
          date: 'Enforced since 2021',
          desc: 'Big messaging apps are legally required to be able to unmask whoever started a message, the moment the government asks. WhatsApp is still in court arguing this is flat-out incompatible with real encryption.',
        },
        {
          place: 'Australia',
          name: 'Australia can legally pressure apps to let them in',
          status: 'enacted',
          statusLabel: 'Already law',
          date: 'In force since 2018',
          desc: "The government can compel tech companies to help crack encrypted messages. Officials swear it can't force a broken lock onto every phone — but where exactly that line sits is still an open fight.",
        },
      ],
    };

    const list = document.getElementById('reg-list');
    const regionButtons = regModal.querySelectorAll('.reg-region-btn');

    const escapeHtml = (str) => str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const renderRegion = (key) => {
      const items = REGULATIONS[key] || [];
      list.innerHTML = items.map((item) => `
        <article class="reg-item">
          <div class="reg-item-head">
            <span class="reg-item-place">${escapeHtml(item.place)}</span>
            <span class="reg-item-status" data-status="${item.status}">${escapeHtml(item.statusLabel)}</span>
          </div>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="reg-item-date">${escapeHtml(item.date)}</p>
          <p class="reg-item-desc">${escapeHtml(item.desc)}</p>
        </article>
      `).join('');
    };

    regionButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        regionButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        renderRegion(btn.dataset.region);
      });
    });

    const closeRegModal = () => regModal.setAttribute('hidden', '');
    const openRegModal = () => {
      regModal.removeAttribute('hidden');
      const card = regModal.querySelector('.reg-modal-card');
      if (card) card.focus();
    };

    try {
      if (!sessionStorage.getItem('osl_reg_popup_shown')) {
        openRegModal();
        sessionStorage.setItem('osl_reg_popup_shown', '1');
      }
    } catch (e) {
      openRegModal();
    }

    regModal.querySelectorAll('[data-reg-close]').forEach((el) => {
      el.addEventListener('click', closeRegModal);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !regModal.hasAttribute('hidden')) closeRegModal();
    });
  }
})();
