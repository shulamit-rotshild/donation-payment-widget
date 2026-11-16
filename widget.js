class DonationPaymentWidget extends HTMLElement {

  scriptReady = false;
  pendingConfig = null;
  stripe = null;
  currentKey = null;

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

    // רק טוענים את הספרייה. החיבור לחשבון Stripe נעשה בכל תשלום, לפי המפתח שהתקבל
    this.loadScript('https://js.stripe.com/v3/').then(() => {
      this.scriptReady = true;
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
      if (this.scriptReady) {
        this.initPayment(config);
      } else {
        this.pendingConfig = config;
      }
    }
  }

  // יוצר חיבור ל-Stripe לפי המפתח הנוכחי, ומחליף אותו אם החשבון השתנה (למשל ארה"ב → קנדה)
  getStripe() {
    const pk = this.getAttribute('publishable-key');
    if (!pk) throw new Error('Missing publishable key');
    if (!this.stripe || this.currentKey !== pk) {
      this.stripe = Stripe(pk);
      this.currentKey = pk;
    }
    return this.stripe;
  }

  // מנקה טופס קודם, כדי שאפשר יהיה לטעון תשלום חדש באותו רכיב
  resetUI() {
    const container = this.querySelector('#payment-element');
    if (container) {
      container.innerHTML = '';
      container.style.display = '';
    }
    const notAvailable = this.querySelector('#wallet-not-available');
    if (notAvailable) notAvailable.style.display = 'none';
    const submitBtn = this.querySelector('#submit-btn');
    if (submitBtn) {
      submitBtn.style.display = 'none';
      submitBtn.onclick = null;
      submitBtn.disabled = false;
    }
    const errorEl = this.querySelector('#error-message');
    if (errorEl) errorEl.innerText = '';
  }

  async initPayment({ clientSecret, mode, amount, currency }) {
    try {
      this.getStripe();
      this.resetUI();
      this.clientSecret = clientSecret;

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
      submitBtn.disabled = true; // מונע לחיצה כפולה ותשלום כפול

      const { error, paymentIntent } = await this.stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required'
      });

      if (error) {
        submitBtn.disabled = false;
        this.querySelector('#error-message').innerText = error.message;
        this.notifyError(error.message, error);
      } else {
        this.notifySuccess(paymentIntent);
      }
    };
  }

  async renderWalletButton(clientSecret, amount, currency) {
    // קושרים ישירות ל-clientSecret (תואם גם לתשלום חד-פעמי וגם למנוי)
    const elements = this.stripe.elements({ clientSecret });
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
        this.notifyError(error.message, error);
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
        status: paymentIntent?.status || null,
        raw: paymentIntent || null
      }
    }));
  }

  // error הוא אובייקט השגיאה של Stripe (אם יש). ממנו לוקחים סוג, קוד סירוב ומזהה העסקה
  notifyError(message, error = null) {
    this.dispatchEvent(new CustomEvent('payment-error', {
      bubbles: true,
      detail: {
        message,
        type: error?.type || null,
        code: error?.code || null,
        declineCode: error?.decline_code || null,
        transactionId: error?.payment_intent?.id || null
      }
    }));
  }
}

customElements.define('donation-payment-widget', DonationPaymentWidget);
