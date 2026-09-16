class DonationPaymentWidget extends HTMLElement {

  stripeReady = false;
  pendingConfig = null;

  connectedCallback() {
    console.log('[donation-widget] connectedCallback started');

    this.innerHTML = `
      <div id="payment-element"></div>
      <div id="wallet-not-available" style="display:none; color:#666; font-size:14px; margin:10px 0;">
        Apple Pay / Google Pay לא זמינים במכשיר זה
      </div>
      <button id="submit-btn" style="display:none; width:100%; padding:12px; margin-top:10px; background:#6b21a8; color:white; border:none; border-radius:6px; font-size:16px; cursor:pointer;">
        אשר תשלום
      </button>
      <div id="error-message" style="color:red; font-size:14px; margin-top:8px;"></div>
    `;

    const pk = this.getAttribute('publishable-key');
    console.log('[donation-widget] publishable-key attribute:', pk ? pk.substring(0, 15) + '...' : 'MISSING!');

    this.loadScript('https://js.stripe.com/v3/').then(() => {
      console.log('[donation-widget] Stripe.js loaded successfully');
      this.stripe = Stripe(pk);
      this.stripeReady = true;
      console.log('[donation-widget] stripe object created, stripeReady = true');
      this.dispatchEvent(new CustomEvent('widget-ready', { bubbles: true }));

      if (this.pendingConfig) {
        console.log('[donation-widget] found pendingConfig, running initPayment now:', this.pendingConfig);
        this.initPayment(this.pendingConfig);
        this.pendingConfig = null;
      } else {
        console.log('[donation-widget] no pendingConfig at this point');
      }
    }).catch(err => {
      console.error('[donation-widget] Failed to load Stripe.js:', err);
    });
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        console.log('[donation-widget] script already present in document:', src);
        resolve();
        return;
      }
      console.log('[donation-widget] injecting script tag for:', src);
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        console.log('[donation-widget] script onload fired:', src);
        resolve();
      };
      script.onerror = (e) => {
        console.error('[donation-widget] script onerror fired:', src, e);
        reject(e);
      };
      document.head.appendChild(script);
    });
  }

  static get observedAttributes() {
    return ['payment-config'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    console.log('[donation-widget] attributeChangedCallback:', name, 'stripeReady=', this.stripeReady);

    if (name === 'payment-config' && newValue) {
      const config = JSON.parse(newValue);
      console.log('[donation-widget] parsed config:', config);

      if (this.stripeReady) {
        console.log('[donation-widget] stripe already ready, calling initPayment immediately');
        this.initPayment(config);
      } else {
        console.log('[donation-widget] stripe not ready yet, storing as pendingConfig');
        this.pendingConfig = config;
      }
    }
  }

  async initPayment({ clientSecret, mode, amount, currency }) {
    console.log('[donation-widget] initPayment called with mode:', mode, 'amount:', amount, 'currency:', currency);
    try {
      this.clientSecret = clientSecret;
      const errorEl = this.querySelector('#error-message');
      if (errorEl) errorEl.innerText = '';

      if (mode === 'wallet') {
        console.log('[donation-widget] routing to renderWalletButton');
        await this.renderWalletButton(clientSecret, amount, currency);
      } else {
        console.log('[donation-widget] routing to renderCardForm');
        this.renderCardForm(clientSecret);
      }
    } catch (err) {
      console.error('[donation-widget] initPayment failed:', err);
      this.notifyError(err.message || 'Unknown error');
    }
  }

  renderCardForm(clientSecret) {
    console.log('[donation-widget] renderCardForm started');
    const elements = this.stripe.elements({ clientSecret });
    this.elements = elements;
    const paymentElement = elements.create('payment');
    paymentElement.mount(this.querySelector('#payment-element'));
    console.log('[donation-widget] paymentElement.mount called');

    const submitBtn = this.querySelector('#submit-btn');
    submitBtn.style.display = 'block';

    submitBtn.onclick = async () => {
      console.log('[donation-widget] submit-btn clicked, calling confirmPayment');
      this.querySelector('#error-message').innerText = '';
      const { error } = await this.stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required'
      });

      if (error) {
        console.error('[donation-widget] confirmPayment error:', error);
        this.querySelector('#error-message').innerText = error.message;
        this.notifyError(error.message);
      } else {
        console.log('[donation-widget] confirmPayment succeeded');
        this.notifySuccess();
      }
    };
  }

  async renderWalletButton(clientSecret, amount, currency) {
    console.log('[donation-widget] renderWalletButton started, amount:', amount, 'currency:', currency);

    const elements = this.stripe.elements({
      mode: 'payment',
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
    });
    this.walletElements = elements;
    console.log('[donation-widget] elements (wallet mode) created');

    const expressCheckoutElement = elements.create('expressCheckout', {
      paymentMethods: {
        applePay: 'always',
        googlePay: 'always',
        link: 'never'
      }
    });
    console.log('[donation-widget] expressCheckoutElement created, mounting...');

    const container = this.querySelector('#payment-element');
    expressCheckoutElement.mount(container);
    console.log('[donation-widget] expressCheckoutElement.mount called');

    expressCheckoutElement.on('ready', ({ availablePaymentMethods }) => {
      console.log('[donation-widget] expressCheckoutElement READY event, availablePaymentMethods:', JSON.stringify(availablePaymentMethods));

      if (!availablePaymentMethods || Object.keys(availablePaymentMethods).length === 0) {
        console.warn('[donation-widget] no wallet payment methods available on this device/browser');
        this.querySelector('#wallet-not-available').style.display = 'block';
        this.dispatchEvent(new CustomEvent('wallet-unavailable', { bubbles: true }));
        container.style.display = 'none';
      }
    });

    expressCheckoutElement.on('loaderror', (event) => {
      console.error('[donation-widget] expressCheckoutElement LOADERROR event:', JSON.stringify(event));
    });

    expressCheckoutElement.on('confirm', async (event) => {
      console.log('[donation-widget] expressCheckoutElement CONFIRM event fired');
      const { error } = await this.stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required'
      });

      if (error) {
        console.error('[donation-widget] wallet confirmPayment error:', error);
        this.notifyError(error.message);
      } else {
        console.log('[donation-widget] wallet confirmPayment succeeded');
        this.notifySuccess();
      }
    });
  }

  notifySuccess() {
    console.log('[donation-widget] notifySuccess - dispatching payment-success event');
    this.dispatchEvent(new CustomEvent('payment-success', { bubbles: true }));
  }

  notifyError(message) {
    console.log('[donation-widget] notifyError - dispatching payment-error event:', message);
    this.dispatchEvent(new CustomEvent('payment-error', { bubbles: true, detail: { message } }));
  }
}

customElements.define('donation-payment-widget', DonationPaymentWidget);
