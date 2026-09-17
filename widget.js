class DonationPaymentWidget extends HTMLElement {

  stripeReady = false;
  pendingConfig = null;

  connectedCallback() {
    this.style.display = 'block';
    this.style.width = '100%';

    this.innerHTML = `
      <div id="payment-element"></div>
      <div id="wallet-not-available" style="display:none; color:#666; font-size:14px; margin:10px 0;">
        Apple Pay / Google Pay לא זמינים במכשיר זה
      </div>
      <button id="submit-btn" style="display:none; width:100%; padding:12px; margin-top:10px; background:#C75EFF; color:#400052; border:none; border-radius:6px; font-size:16px; font-weight:700; cursor:pointer;">
        אשר תשלום
      </button>
      <div id="error-message" style="color:red; font-size:14px; margin-top:8px;"></div>
    `;

    // גובה אוטומטי - עוקבים אחרי שינויים בתוכן ומעדכנים את גובה הרכיב עצמו
    const resizeObserver = new ResizeObserver(() => {
      this.style.height = this.scrollHeight + 'px';
    });
    resizeObserver.observe(this);

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

  getAppearance() {
    return {
      theme: 'stripe',
      variables: {
        colorPrimary: '#C75EFF',
        colorText: '#400052',
        colorTextSecondary: '#400052',
        colorTextPlaceholder: '#9B7FA8',
        fontFamily: 'Assistant, sans-serif',
        borderRadius: '6px',
        spacingUnit: '4px',
      },
      rules: {
        '.Label': {
          color: '#400052',
          fontWeight: '600',
        },
        '.Input': {
          border: '1px solid #D8B4E8',
        },
        '.Input:focus': {
          border: '1px solid #C75EFF',
          boxShadow: '0 0 0 1px #C75EFF',
        },
      }
    };
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
    const elements = this.stripe.elements({ clientSecret, appearance: this.getAppearance() });
    this.elements = elements;
    const paymentElement = elements.create('payment');
    paymentElement.mount(this.querySelector('#payment-element'));

    const submitBtn = this.querySelector('#submit-btn');
    submitBtn.style.display = 'block';

    submitBtn.onclick = async () => {
      this.querySelector('#error-message').innerText = '';
      const { error, paymentIntent } = await this.stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required'
      });

      if (error) {
        this.querySelector('#error-message').innerText = error.message;
        this.notifyError(error.message);
      } else {
        this.notifySuccess(paymentIntent);
      }
    };
  }

  async renderWalletButton(clientSecret, amount, currency) {
    const elements = this.stripe.elements({ clientSecret, appearance: this.getAppearance() });
    this.walletElements = elements;

    const expressCheckoutElement = elements.create('expressCheckout', {
      paymentMethods: {
        applePay: 'always',
        googlePay: 'always',
        link: 'never'
      }
    });

    const container = this.querySelector('#payment-element');
    expressCheckoutElement.mount(container);

    expressCheckoutElement.on('ready', ({ availablePaymentMethods }) => {
      if (!availablePaymentMethods || Object.keys(availablePaymentMethods).length === 0) {
        this.querySelector('#wallet-not-available').style.display = 'block';
        this.dispatchEvent(new CustomEvent('wallet-unavailable', { bubbles: true }));
        container.style.display = 'none';
      }
    });

    expressCheckoutElement.on('confirm', async (event) => {
      const { error, paymentIntent } = await this.stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required'
      });

      if (error) {
        this.notifyError(error.message);
      } else {
        this.notifySuccess(paymentIntent);
      }
    });
  }

  notifySuccess(paymentIntent) {
    this.dispatchEvent(new CustomEvent('payment-success', {
      bubbles: true,
      detail: {
        transactionId: paymentIntent?.id || null,
        amount: paymentIntent ? paymentIntent.amount / 100 : null,
        currency: paymentIntent?.currency || null,
        status: paymentIntent?.status || null
      }
    }));
  }

  notifyError(message) {
    this.dispatchEvent(new CustomEvent('payment-error', { bubbles: true, detail: { message } }));
  }
}

customElements.define('donation-payment-widget', DonationPaymentWidget);
