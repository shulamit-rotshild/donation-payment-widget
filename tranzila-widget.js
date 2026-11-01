class TranzilaPaymentWidget extends HTMLElement {

  pendingConfig = null;

  connectedCallback() {
    this.innerHTML = `
      <div style="padding:24px; text-align:center; font-family:sans-serif; font-size:16px;">
        מעבירים אותך לדף התשלום המאובטח...
      </div>
    `;
    if (this.pendingConfig) {
      this.start(this.pendingConfig);
      this.pendingConfig = null;
    }
  }

  static get observedAttributes() {
    return ['payment-config'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name !== 'payment-config' || !newValue) return;
    const config = JSON.parse(newValue);
    if (this.isConnected) {
      this.start(config);
    } else {
      this.pendingConfig = config;
    }
  }

  start({ action, fields }) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    form.target = '_top'; // פותח את עמוד התשלום של טרנזילה בכל הדף
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
  }
}

customElements.define('tranzila-payment-widget', TranzilaPaymentWidget);
