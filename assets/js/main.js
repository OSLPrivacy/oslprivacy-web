(() => {
  'use strict';

  const API = 'https://keyserver.oslprivacy.com';
  const STRIPE_DELIVERY_KEY = 'osl_stripe_delivery_v1';
  const CRYPTO_DELIVERY_KEY = 'osl_crypto_delivery_v1';

  const bytesToBase64 = (bytes) => {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  };

  const bytesToBase64Url = (bytes) => bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const setStatus = (element, message, tone = '') => {
    if (!element) return;
    element.textContent = message;
    if (tone) element.dataset.tone = tone;
    else delete element.dataset.tone;
  };

  const delay = (milliseconds) => new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

  async function createDeliveryBundle() {
    if (!window.crypto?.subtle || !window.sessionStorage) {
      throw new Error('Secure activation requires a current browser with Web Crypto enabled.');
    }
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );
    const [publicSpki, privateJwk] = await Promise.all([
      crypto.subtle.exportKey('spki', pair.publicKey),
      crypto.subtle.exportKey('jwk', pair.privateKey),
    ]);
    const claimBytes = new Uint8Array(32);
    crypto.getRandomValues(claimBytes);
    return {
      claimToken: bytesToBase64Url(claimBytes),
      deliveryPublicKeySpki: bytesToBase64(new Uint8Array(publicSpki)),
      privateJwk,
      createdAt: Date.now(),
    };
  }

  async function decryptActivationCode(encryptedBase64, privateJwk) {
    const key = await crypto.subtle.importKey(
      'jwk',
      privateJwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
    const binary = atob(encryptedBase64);
    const encrypted = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, encrypted);
    return new TextDecoder().decode(plaintext);
  }

  async function copyText(value, button) {
    try {
      await navigator.clipboard.writeText(value);
      if (button) {
        const prior = button.textContent;
        button.textContent = 'Copied';
        window.setTimeout(() => { button.textContent = prior; }, 1400);
      }
    } catch {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  }

  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.copyTarget);
      if (target) void copyText(target.textContent.trim(), button);
    });
  });

  const form = document.getElementById('notify-form');
  const formStatus = document.getElementById('form-status');
  if (form && formStatus) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus(
        formStatus,
        'Email signup is not connected yet. Use the project GitHub for release updates.',
        'error',
      );
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

  const privacyWarning = document.getElementById('privacy-warning');
  const locationButton = document.getElementById('privacy-location-button');
  const locationResult = document.getElementById('privacy-location-result');
  const manualLocationForm = document.getElementById('manual-location-form');
  const manualLocationInput = document.getElementById('manual-location');
  const agencyResult = document.getElementById('agency-result');
  const agencyResultCopy = document.getElementById('agency-result-copy');
  const agencyResultList = document.getElementById('agency-result-list');
  const usIntelligenceResultList = document.getElementById('us-intelligence-result-list');
  const serviceResultList = document.getElementById('service-result-list');
  const privacyWarningKey = 'osl_privacy_warning_seen_v2';

  const agencyProfiles = {
    us: {
      label: 'the United States',
      warning: 'Police can demand stored messages when the law allows. Foreign intelligence programs can also collect communications tied to foreign targets.',
      agencies: [
        { name: 'FBI and federal prosecutors', detail: 'Can seek provider records through subpoenas, court orders, or warrants.', url: 'https://www.justice.gov/jm/jm-9-13000-obtaining-evidence' },
        { name: 'State and local police', detail: 'Can seek stored service data when the required legal authority exists.', url: 'https://www.justice.gov/jm/jm-9-13000-obtaining-evidence' },
      ],
    },
    uk: {
      label: 'the United Kingdom',
      warning: 'Police and intelligence agencies can seek stored communications under UK law.',
      agencies: [
        { name: 'Police and NCA', detail: 'Can request communications data under statutory powers and required approvals.', url: 'https://www.gov.uk/government/organisations/office-for-communications-data-authorisations/about' },
        { name: 'MI5', detail: 'Uses legally authorized intelligence-gathering techniques, including interception.', url: 'https://www.mi5.gov.uk/what-we-do' },
        { name: 'GCHQ', detail: 'Collects communications and data believed to have foreign-intelligence value under legal controls.', url: 'https://www.gchq.gov.uk/section/mission/overview' },
      ],
    },
    canada: {
      label: 'Canada',
      warning: 'Police and intelligence agencies can seek stored communications under Canadian law.',
      agencies: [
        { name: 'RCMP and local police', detail: 'Can seek communications or subscriber data with the legal authority required for the request.', url: 'https://www.justice.gc.ca/eng/cons/la-al/sum-res/faq.html' },
        { name: 'CSIS', detail: 'Collects and analyzes security intelligence under its statutory mandate.', url: 'https://www.canada.ca/en/security-intelligence-service/corporate/mandate.html' },
        { name: 'CSE', detail: 'Handles foreign intelligence and can provide authorized technical assistance.', url: 'https://www.cse-cst.gc.ca/en/corporate-information/mandate' },
      ],
    },
    australia: {
      label: 'Australia',
      warning: 'Police and intelligence agencies can intercept or seek stored communications under Australian law.',
      agencies: [
        { name: 'AFP and state police', detail: 'Can use lawful telecommunications-access powers for eligible investigations.', url: 'https://www.homeaffairs.gov.au/about-us/our-portfolios/national-security/lawful-access-telecommunications/telecommunications-interception-and-surveillance' },
        { name: 'ASIO', detail: 'Can use national-security telecommunications powers subject to applicable authorization.', url: 'https://www.homeaffairs.gov.au/about-us/our-portfolios/national-security/lawful-access-telecommunications/telecommunications-interception-and-surveillance' },
        { name: 'ASD', detail: 'Runs foreign signals intelligence and can provide authorized assistance.', url: 'https://www.asd.gov.au/about/what-we-do/signals-intelligence' },
      ],
    },
    europe: {
      label: 'Europe',
      warning: 'National authorities can seek stored data. Cross-border investigations can move it between countries.',
      agencies: [
        { name: 'National police and prosecutors', detail: 'Can seek service data under the law of the country handling the case.', url: 'https://www.eurojust.europa.eu/judicial-cooperation/instruments/electronic-evidence' },
        { name: 'Europol', detail: 'Supports member-state investigations and information exchange but does not itself arrest people.', url: 'https://www.europol.europa.eu/about-europol' },
        { name: 'Eurojust', detail: 'Coordinates judicial cooperation and electronic-evidence work across borders.', url: 'https://www.eurojust.europa.eu/judicial-cooperation/instruments/electronic-evidence' },
      ],
    },
    other: {
      label: 'your region',
      warning: 'Local authorities may seek stored data. Foreign partners may receive it through cross-border investigations.',
      agencies: [
        { name: 'Police and prosecutors', detail: 'Local law determines what they can demand and what approval is required.', url: 'https://www.interpol.int/en/Who-we-are/Member-countries/National-Central-Bureaus-NCBs' },
        { name: 'Domestic intelligence services', detail: 'National-security powers and safeguards vary sharply by country.', url: 'https://www.interpol.int/en/Who-we-are/What-is-INTERPOL' },
        { name: 'International partners', detail: 'National police can exchange information through cross-border cooperation channels.', url: 'https://www.interpol.int/en/Who-we-are/What-is-INTERPOL' },
      ],
    },
  };

  const usIntelligenceProfiles = [
    {
      name: 'NSA',
      detail: 'Collects foreign signals intelligence. Messages that cross borders or involve foreign targets can enter that system.',
      url: 'https://www.nsa.gov/Signals-Intelligence/Overview/',
    },
    {
      name: 'CIA',
      detail: 'Collects foreign intelligence worldwide. It is not a domestic police force.',
      url: 'https://www.cia.gov/about/',
    },
  ];

  const serviceProfiles = [
    { name: 'Discord', detail: 'Keeps account, content, device, IP address, and usage data. Discord says it does not sell personal data.', url: 'https://discord.com/privacy' },
    { name: 'Meta', detail: 'Combines content, activity, device, location, and partner data to personalize products and ads.', url: 'https://www.facebook.com/privacy/policy/' },
    { name: 'Google', detail: 'Keeps searches, viewing activity, device, IP address, and location signals. It uses them for personalization, measurement, and ads.', url: 'https://policies.google.com/privacy' },
    { name: 'X', detail: 'Keeps posts, direct message information, device, location, ad, and partner data. X says it does not sell personal data.', url: 'https://x.com/en/privacy' },
  ];

  const profileForText = (value) => {
    const text = value.trim().toLowerCase();
    if (/\b(united states|usa|u\.s\.?|america)\b/.test(text)) return agencyProfiles.us;
    if (/\b(united kingdom|uk|u\.k\.?|england|scotland|wales|northern ireland|britain)\b/.test(text)) return agencyProfiles.uk;
    if (/\bcanada\b/.test(text)) return agencyProfiles.canada;
    if (/\baustralia\b/.test(text)) return agencyProfiles.australia;
    if (/\b(europe|european union|eu|france|germany|italy|spain|portugal|netherlands|belgium|ireland|poland|sweden|norway|denmark|finland|austria|switzerland|greece|romania|czechia|czech republic)\b/.test(text)) return agencyProfiles.europe;
    return { ...agencyProfiles.other, label: value.trim() || agencyProfiles.other.label };
  };

  const profileForCoordinates = (latitude, longitude) => {
    const inBox = (south, north, west, east) => latitude >= south && latitude <= north && longitude >= west && longitude <= east;
    if (inBox(18, 72, -170, -66) || inBox(18, 23, -161, -154)) return agencyProfiles.us;
    if (inBox(41, 84, -141, -52)) return agencyProfiles.canada;
    if (inBox(49, 61, -9, 2)) return agencyProfiles.uk;
    if (inBox(-45, -9, 112, 154)) return agencyProfiles.australia;
    if (inBox(34, 72, -11, 40)) return agencyProfiles.europe;
    return agencyProfiles.other;
  };

  const exposureCard = (entry) => {
    const card = document.createElement('article');
    const title = document.createElement('h4');
    const detail = document.createElement('p');
    const source = document.createElement('a');
    title.textContent = entry.name;
    detail.textContent = entry.detail;
    source.href = entry.url;
    source.target = '_blank';
    source.rel = 'noopener';
    source.textContent = 'Official source';
    card.append(title, detail, source);
    return card;
  };

  const showAgencyProfile = (profile) => {
    if (!agencyResult || !agencyResultCopy || !agencyResultList || !usIntelligenceResultList || !serviceResultList) return;
    agencyResultCopy.textContent = profile.warning;
    agencyResultList.replaceChildren(...profile.agencies.map(exposureCard));
    usIntelligenceResultList.replaceChildren(...usIntelligenceProfiles.map(exposureCard));
    serviceResultList.replaceChildren(...serviceProfiles.map(exposureCard));
    agencyResult.hidden = false;
  };

  const closePrivacyWarning = () => {
    if (privacyWarning?.open) privacyWarning.close();
  };

  if (privacyWarning instanceof HTMLDialogElement) {
    let shouldOpen = true;
    try {
      shouldOpen = localStorage.getItem(privacyWarningKey) !== '1';
      if (shouldOpen) localStorage.setItem(privacyWarningKey, '1');
    } catch {
      shouldOpen = true;
    }
    if (shouldOpen) privacyWarning.showModal();

    privacyWarning.querySelectorAll('[data-privacy-warning-close]').forEach((control) => {
      control.addEventListener('click', closePrivacyWarning);
    });
    privacyWarning.addEventListener('click', (event) => {
      if (event.target === privacyWarning) closePrivacyWarning();
    });
  }

  if (locationButton && locationResult) {
    locationButton.addEventListener('click', () => {
      if (!navigator.geolocation) {
        setStatus(locationResult, 'This browser does not provide a location check.', 'error');
        return;
      }
      locationButton.disabled = true;
      locationButton.textContent = 'Waiting for permission...';
      setStatus(locationResult, 'Your browser may ask for location access.');
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          setStatus(locationResult, 'Approximate result. Choose a country to correct it.', 'success');
          showAgencyProfile(profileForCoordinates(coords.latitude, coords.longitude));
          locationButton.textContent = 'Location checked';
        },
        () => {
          setStatus(locationResult, 'Location was not shared. Enter a country instead.', 'error');
          locationButton.disabled = false;
          locationButton.textContent = 'Try location again';
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
      );
    });
  }

  if (manualLocationForm && manualLocationInput && locationResult) {
    manualLocationForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = manualLocationInput.value.trim();
      if (!value) return;
      showAgencyProfile(profileForText(value));
      setStatus(locationResult, `${value} selected. Nothing left this browser.`, 'success');
    });
  }

  const subscribeButton = document.querySelector('.cta-subscribe');
  const checkoutStatus = document.getElementById('checkout-status');
  if (subscribeButton) {
    subscribeButton.addEventListener('click', async () => {
      const label = subscribeButton.textContent;
      subscribeButton.disabled = true;
      subscribeButton.textContent = 'Opening Stripe...';
      setStatus(checkoutStatus, 'Opening Stripe checkout...');
      try {
        const delivery = await createDeliveryBundle();
        sessionStorage.setItem(STRIPE_DELIVERY_KEY, JSON.stringify(delivery));
        const response = await fetch(`${API}/v1/checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: 'pro',
            claim_token: delivery.claimToken,
            delivery_public_key_spki: delivery.deliveryPublicKeySpki,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.url !== 'string' || typeof result.session_id !== 'string') {
          throw new Error(result.error || 'Live checkout is temporarily unavailable.');
        }
        sessionStorage.setItem(STRIPE_DELIVERY_KEY, JSON.stringify({
          ...delivery,
          sessionId: result.session_id,
        }));
        window.location.assign(result.url);
      } catch (error) {
        sessionStorage.removeItem(STRIPE_DELIVERY_KEY);
        setStatus(
          checkoutStatus,
          error instanceof Error ? error.message : 'Live checkout is temporarily unavailable.',
          'error',
        );
        subscribeButton.disabled = false;
        subscribeButton.textContent = label;
      }
    });
  }

  function showActivationCode(code, panel = document.getElementById('activation-panel')) {
    if (!panel) return;
    panel.querySelectorAll('[data-activation-code]').forEach((codeElement) => {
      codeElement.textContent = code;
    });
    panel.hidden = false;
    panel.focus?.();
  }

  async function loadStripeActivation() {
    const status = document.getElementById('activation-status');
    if (!status) return;
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    let delivery;
    try {
      delivery = JSON.parse(sessionStorage.getItem(STRIPE_DELIVERY_KEY) || 'null');
    } catch {
      delivery = null;
    }
    if (!sessionId || !delivery?.claimToken || !delivery?.privateJwk) {
      setStatus(
        status,
        'This checkout is not linked to the browser tab that started it. Contact support with your Stripe receipt so the purchase can be recovered.',
        'error',
      );
      return;
    }
    setStatus(status, "Payment received. Waiting for Stripe's signed confirmation...");
    for (let attempt = 0; attempt < 45; attempt += 1) {
      try {
        const response = await fetch(`${API}/v1/checkout/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, claim_token: delivery.claimToken }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.status === 'delivery_ready' && result.encrypted_license) {
          const code = await decryptActivationCode(result.encrypted_license, delivery.privateJwk);
          showActivationCode(code);
          const heading = document.getElementById('payment-heading');
          if (heading) heading.textContent = 'Payment confirmed';
          setStatus(status, 'Activation code ready. It was decrypted only in this browser tab.', 'success');
          return;
        }
        if (!response.ok && response.status !== 404) {
          throw new Error(result.error || 'Activation delivery failed.');
        }
      } catch (error) {
        if (attempt >= 44) {
          setStatus(status, error instanceof Error ? error.message : 'Activation delivery failed.', 'error');
          return;
        }
      }
      await delay(2000);
    }
    setStatus(status, 'Stripe confirmation is taking longer than expected. Keep this tab open or contact support with your receipt.', 'error');
  }
  void loadStripeActivation();

  const paymentDialog = document.getElementById('crypto-dialog');
  const cryptoStatus = document.getElementById('crypto-status');
  const cryptoAddress = document.getElementById('crypto-address');
  const cryptoAmount = document.getElementById('crypto-amount');
  const cryptoConfirmations = document.getElementById('crypto-confirmations');
  const cryptoExpires = document.getElementById('crypto-expires');

  async function pollCrypto(invoice, delivery) {
    while (Math.floor(Date.now() / 1000) < invoice.expires_at) {
      await delay(5000);
      const response = await fetch(`${API}/v1/crypto/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: invoice.invoice_id,
          claim_token: invoice.claim_token,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.encrypted_license) {
        const code = await decryptActivationCode(result.encrypted_license, delivery.privateJwk);
        showActivationCode(code, document.getElementById('crypto-activation-panel'));
        setStatus(cryptoStatus, 'Payment confirmed by the network. Activation code ready.', 'success');
        return;
      }
      if (result.status === 'expired') break;
      setStatus(cryptoStatus, 'Waiting for the required network confirmations...');
    }
    setStatus(cryptoStatus, 'This quote expired before confirmation. Start a new invoice and do not reuse the address.', 'error');
  }

  document.querySelectorAll('[data-crypto-method]').forEach((button) => {
    button.addEventListener('click', async () => {
      const paymentMethod = button.dataset.cryptoMethod;
      button.disabled = true;
      setStatus(checkoutStatus, 'Creating a unique payment address...');
      try {
        const delivery = await createDeliveryBundle();
        const response = await fetch(`${API}/v1/crypto/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: 'pro',
            payment_method: paymentMethod,
            delivery_public_key_spki: delivery.deliveryPublicKeySpki,
          }),
        });
        const invoice = await response.json().catch(() => ({}));
        if (!response.ok || !invoice.claim_token || !invoice.address) {
          throw new Error(invoice.error || 'Crypto checkout is temporarily unavailable.');
        }
        sessionStorage.setItem(CRYPTO_DELIVERY_KEY, JSON.stringify({ delivery, invoice }));
        cryptoAddress.textContent = invoice.address;
        cryptoAmount.textContent = `${invoice.amount_native} ${paymentMethod.toUpperCase()}`;
        if (cryptoConfirmations) {
          cryptoConfirmations.textContent = `${invoice.confirmations_required} network confirmations`;
        }
        if (cryptoExpires) {
          cryptoExpires.textContent = new Date(invoice.expires_at * 1000).toLocaleString();
        }
        setStatus(cryptoStatus, 'Send the exact amount once. The code appears here after the node confirms payment.');
        paymentDialog.showModal();
        void pollCrypto(invoice, delivery);
      } catch (error) {
        setStatus(checkoutStatus, error instanceof Error ? error.message : 'Crypto checkout is temporarily unavailable.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => paymentDialog?.close());
  });
})();
