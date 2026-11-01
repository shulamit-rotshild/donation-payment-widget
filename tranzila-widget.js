class TranzilaPaymentWidget extends HTMLElement {

  pendingConfig = null;
  allowedOrigin = null;

  connectedCallback() {
    this.frameName = 'tranzila-frame-' + Math.random().toString(36).slice(2);
    this.innerHTML = `
      <iframe name="${this.frameName}" allowpaymentrequest="true"
        style="width:100%; height:650px; border:0;"></iframe>
    `;

    this.onMessage = (event) => {
      if (this.allowedOrigin && event.origin !== this.allowedOrigin) return;
      const data = event.data;
      if (!data || data.type !== 'tranzila-result') return;

      if (data.ok) {
        this.dispatchEvent(new CustomEvent('payment-success', {
          bubbles: true,
          detail: {
            transactionId: data.transactionId || null,
            amount: data.amount ? Number(data.amount) : null,
            currency: 'ils',
            status: 'succeeded',
            raw: null
          }
        }));
      } else {
        this.dispatchEvent(new CustomEvent('payment-error', {
          bubbles: true,
          detail: { message: data.message || 'התשלום נכשל' }
        }));
      }
    };
    window.addEventListener('message', this.onMessage);

    if (this.pendingConfig) {
      this.start(this.pendingConfig);
      this.pendingConfig = null;
    }
  }

  disconnectedCallback() {
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
  }

  static get observedAttributes() {
    return ['payment-config'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name !== 'payment-config' || !newValue) return;
    const config = JSON.parse(newValue);
    if (this.isConnected && this.frameName) {
      this.start(config);
    } else {
      this.pendingConfig = config;
    }
  }

  start({ action, fields, allowedOrigin }) {
    this.allowedOrigin = allowedOrigin || null;

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    form.target = this.frameName;
    form.style.display = 'none';

    Object.keys(fields).forEach((key) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = fields[key];
      form.appendChild(input);
    });

    this.appendChild(form);
    form.submit();
    form.remove();
  }
}

customElements.define('tranzila-payment-widget', TranzilaPaymentWidget);
