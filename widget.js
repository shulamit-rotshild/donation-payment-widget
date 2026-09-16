class DonationPaymentWidget extends HTMLElement {

  stripeReady = false;
  pendingConfig = null;

  connectedCallback() {
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

    this.loadScript('https://js.stripe.com/v3/').then(() => {
      this.stripe = Stripe(pk);
      this.stripeReady = true;
      this.dispatchEvent(new CustomEvent('widget-ready', { bubbles: true }));

      if (this.pendingConfig) {
        this.initPayment(this.pendingConfig);
        this.pendingConfig = null;
      }
    }).catch(err => {
      console.error('Failed to load Stripe.js:', err);
    });
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  static get observedAttributes() {
    return ['payment-config'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'payment-config' && newValue) {
      const config = JSON.parse(newValue);

      if (this.stripeReady) {
        this.initPayment(config);
      } else {
        this.pendingConfig = config;
      }
    }
  }

  async initPayment({ clientSecret, mode, amount, currency }) {
    try {
      this.clientSecret = clientSecret;
      const errorEl = this.querySelector('#error-message');
      if (errorEl) errorEl.innerText = '';

      if (mode === 'wallet') {
        await this.renderWalletButton(clientSecret, amount, currency);
      } else {
        this.renderCardForm(clientSecret);
      }
    } catch (err) {
      console.error('[donation-widget] initPayment failed:', err);
      this.notifyError(err.message || 'Unknown error');
    }
  }

  renderCardForm(clientSecret) {
    const elements = this.stripe.elements({ clientSecret });
    this.elements = elements;
    const paymentElement = elements.create('payment');
    paymentElement.mount(this.querySelector('#payment-element'));

    const submitBtn = this.querySelector('#submit-btn');
    submitBtn.style.display = 'block';

    submitBtn.onclick = async () => {
      this.querySelector('#error-message').innerText = '';
      const { error } = await this.stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required'
      });

      if (error) {
        this.querySelector('#error-message').innerText = error.message;
        this.notifyError(error.message);
      } else {
        this.notifySuccess();
      }
    };
  }

  async renderWalletButton(clientSecret, amount, currency) {
    const paymentRequest = this.stripe.paymentRequest({
      country: currency === 'USD' ? 'US' : 'IL',
      currency: currency.toLowerCase(),
      total: { label: 'תרומה', amount: Math.round(amount * 100) },
      requestPayerName: true,
      requestPayerEmail: true,
    });

    const elements = this.stripe.elements();
    const prButton = elements.create('paymentRequestButton', { paymentRequest });

    const result = await paymentRequest.canMakePayment();

    if (!result) {
      this.querySelector('#wallet-not-available').style.display = 'block';
      this.dispatchEvent(new CustomEvent('wallet-unavailable', { bubbles: true }));
      return;
    }

    prButton.mount(this.querySelector('#payment-element'));

    paymentRequest.on('paymentmethod', async (ev) => {
      const { paymentIntent, error } = await this.stripe.confirmCardPayment(
        clientSecret,
        { payment_method: ev.paymentMethod.id },
        { handleActions: false }
      );

      if (error) {
        ev.complete('fail');
        this.notifyError(error.message);
        return;
      }

      ev.complete('success');

      if (paymentIntent.status === 'requires_action') {
        const { error: confirmError } = await this.stripe.confirmCardPayment(clientSecret);
        if (confirmError) {
          this.notifyError(confirmError.message);
          return;
        }
      }

      this.notifySuccess();
    });
  }

  notifySuccess() {
    this.dispatchEvent(new CustomEvent('payment-success', { bubbles: true }));
  }

  notifyError(message) {
    this.dispatchEvent(new CustomEvent('payment-error', { bubbles: true, detail: { message } }));
  }
}

customElements.define('donation-payment-widget', DonationPaymentWidget);
