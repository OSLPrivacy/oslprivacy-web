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
          name: "The EU's chat-scanning law just passed — but E2EE apps got a carve-out",
          status: 'enacted',
          statusLabel: 'In force until 2028',
          date: 'Adopted 10 July 2026 — runs until 3 April 2028',
          desc: "Parliament renewed the rule letting messaging platforms scan for child-abuse material — even though more MEPs voted to kill it (314) than to keep it (276), it survived because rejecting a Council position needs an absolute majority of all 720 seats, and that bar wasn't reached. The same day, Parliament also passed a carve-out excluding genuinely end-to-end encrypted apps from the scanning regime — so this specific rule doesn't reach what you send through OSL.",
          sources: [
            { label: 'European Parliament press release, 10 Jul 2026', url: 'https://www.europarl.europa.eu/news/en/press-room/20260706IPR46318/combating-child-sexual-abuse-support-for-a-more-limited-eprivacy-derogation' },
          ],
        },
        {
          place: 'European Union',
          name: 'A permanent, mandatory scanning law is still being negotiated',
          status: 'proposed',
          statusLabel: 'Not law yet',
          date: 'Trilogue talks resume September 2026',
          desc: "The rule above is a temporary stopgap. Brussels is still negotiating a permanent “Chat Control 2.0” regulation that — in earlier drafts — would require apps to scan messages on your device before they're even encrypted, no exceptions. That's the version that would actually threaten how OSL works. Nothing about it is final yet.",
          sources: [
            { label: 'Fight Chat Control — Chat Control 1.0 vs 2.0 overview', url: 'https://fightchatcontrol.eu/chat-control-overview' },
          ],
        },
        {
          place: 'United Kingdom',
          name: 'The UK can already order apps to read your chats',
          status: 'enacted',
          statusLabel: 'Already law',
          date: 'Online Safety Act passed 26 October 2023',
          desc: 'Under the Online Safety Act, the regulator Ofcom can legally order messaging apps to scan what you type — encrypted or not — whenever it decides that’s “technically feasible.” The government says it won’t enforce that power yet because no privacy-preserving scanning technology exists, but the legal power itself is already in force. Signal and WhatsApp both said they’d rather leave the UK than build that door in.',
          sources: [
            { label: 'Online Safety Act 2023 — full text', url: 'https://www.legislation.gov.uk/ukpga/2023/50' },
            { label: 'Online Safety Act explainer (GOV.UK)', url: 'https://www.gov.uk/government/publications/online-safety-act-explainer/online-safety-act-explainer' },
          ],
        },
      ],
      namerica: [
        {
          place: 'United States',
          name: 'The Patriot Act and a CIA executive order already give the government broad reach',
          status: 'enacted',
          statusLabel: 'Already law',
          date: 'Patriot Act: 2001, reformed 2015 — EO 12333: 1981, still active',
          desc: "Section 215 of the Patriot Act lets the FBI ask a secret court for your “business records” during a terrorism investigation — bulk phone-record collection was banned in 2015, but the authority to target specific records is still on the books. Separately, Executive Order 12333 is the standing authority the CIA uses to collect signals intelligence — it's restricted from targeting people inside the US, but there's no equivalent limit on what it collects overseas. Encryption stops any of this from producing readable message content, but it doesn't hide who you're messaging or when — that's on whatever service sits underneath your encryption.",
          sources: [
            { label: 'DOJ fact sheet — USA PATRIOT Act provisions', url: 'https://www.justice.gov/archive/opa/pr/2005/April/05_opa_163.htm' },
            { label: 'Executive Order 12333 — full text (National Archives)', url: 'https://www.archives.gov/federal-register/codification/executive-order/12333.html' },
            { label: "CIA statement on its EO 12333 authority", url: 'https://www.cia.gov/stories/story/statement-on-the-release-of-the-central-intelligence-agencys-updated-executive-order-12333-procedures/' },
          ],
        },
        {
          place: 'United States',
          name: 'US lawmakers keep trying to weaken your encryption',
          status: 'proposed',
          statusLabel: 'Not law yet',
          date: 'Reintroduced in 2020, 2022, and 2023',
          desc: "The EARN IT Act would strip legal protections from any app that can't hand over readable messages on demand — a real threat to end-to-end encryption. It's been introduced three times and has died in Congress every time so far, but it keeps coming back, and it only has to pass once.",
          sources: [
            { label: 'EARN IT Act of 2023 — S.1207 full text (Congress.gov)', url: 'https://www.congress.gov/bill/118th-congress/senate-bill/1207/text' },
          ],
        },
      ],
      apac: [
        {
          place: 'China',
          name: 'China requires companies to cooperate with intelligence work — and blocks encrypted apps outright',
          status: 'enacted',
          statusLabel: 'Already law',
          date: 'National Intelligence Law: 2017 — Signal blocked: 2021',
          desc: "Article 7 of China's National Intelligence Law requires every organization and citizen to “support, assist, and cooperate” with state intelligence work — there's no carve-out for tech companies, and legal analysts note there's effectively no way to refuse a direct request from state security. On top of that, the Great Firewall blocks foreign encrypted messengers outright: WhatsApp and Telegram are inaccessible without a VPN, and Signal — one of the last holdouts — was blocked in 2021. OSL doesn't operate in China and isn't in a position to resist a law like this where it applies.",
          sources: [
            { label: 'National Intelligence Law of the PRC, Art. 7 — translation (China Law Translate)', url: 'https://www.chinalawtranslate.com/en/what-the-national-intelligence-law-says-and-why-it-doesnt-matter/' },
            { label: 'Signal blocked in China (South China Morning Post)', url: 'https://www.scmp.com/tech/policy/article/3125694/chinas-great-firewall-ensnares-encrypted-messaging-app-signal-joining' },
          ],
        },
        {
          place: 'India',
          name: 'India can already demand to know who sent a message',
          status: 'enacted',
          statusLabel: 'Already law',
          date: 'IT Rules, Rule 4(2), in force since 2021',
          desc: 'Large messaging apps are legally required to be able to unmask whoever “first originated” a message, the moment a court or the government orders it. WhatsApp challenged this in the Delhi High Court, arguing it’s flatly incompatible with real end-to-end encryption — the case is still unresolved.',
          sources: [
            { label: 'IT Intermediary Guidelines Rules 2021, Rule 4(2) (meity.gov.in)', url: 'https://www.meity.gov.in/static/uploads/2024/02/IT-Intermediary-Rules-2021-updated-on-28.10.2022-2.pdf' },
          ],
        },
        {
          place: 'Australia',
          name: 'Australia can legally pressure apps to let them in',
          status: 'enacted',
          statusLabel: 'Already law',
          date: 'Assistance and Access Act, in force since 2018',
          desc: 'The government can issue notices compelling tech companies to help access encrypted communications — up to and including building new capabilities to do it. The law technically bans forcing a company to introduce a “systemic weakness,” but where that line actually sits is still disputed.',
          sources: [
            { label: 'Assistance and Access Act 2018 — full text (legislation.gov.au)', url: 'https://www.legislation.gov.au/Details/C2018A00148' },
          ],
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
      list.innerHTML = items.map((item) => {
        const sources = (item.sources || []).map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a>`).join(' · ');
        return `
        <article class="reg-item">
          <div class="reg-item-head">
            <span class="reg-item-place">${escapeHtml(item.place)}</span>
            <span class="reg-item-status" data-status="${item.status}">${escapeHtml(item.statusLabel)}</span>
          </div>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="reg-item-date">${escapeHtml(item.date)}</p>
          <p class="reg-item-desc">${escapeHtml(item.desc)}</p>
          ${sources ? `<p class="reg-item-sources">Source: ${sources}</p>` : ''}
        </article>
      `;
      }).join('');
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
