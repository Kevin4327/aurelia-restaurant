/**
 * Aurelia Coastal Kitchen — Shared Front-End Application Logic
 * Connects multi-page UI to PHP backend (api.php).
 */
(() => {
  'use strict';

  const STORAGE_CART_KEY = 'aurelia_cart_v2';
  const STORAGE_ORDERS_KEY = 'aurelia_recent_orders_v2';
  const STORAGE_RES_KEY = 'aurelia_my_reservations_v2';

  const FALLBACK_IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
        <rect width="800" height="500" fill="#e8dfd3"/>
        <circle cx="400" cy="235" r="88" fill="#d9cbb8"/>
        <text x="400" y="245" text-anchor="middle" font-family="Georgia, serif" font-size="32" fill="#7c563a">AURELIA</text>
        <text x="400" y="365" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#675e56">Wood-Fired Coastal Kitchen</text>
      </svg>`
    );

  const state = {
    menu: [],
    settings: {
      accepting_orders: true,
      prep_time_min: 20,
      delivery_eta_min: 35,
      delivery_fee: 4.5,
      tax_rate: 0.0875,
      payment_gateway: {
        enabled: true,
        provider: 'stripe_ready',
        mode: 'sandbox',
        label: 'Online Card / Gateway (Demo Ready)',
        checkout_note: 'Demo gateway active; live Stripe/PayHere keys can be connected anytime in Admin.',
      },
    },
    cart: loadJson(STORAGE_CART_KEY, []),
    fulfillmentMode: 'pickup',
    promoCode: '',
    promoRate: 0,
    tipPercent: 10,
    paymentMethod: 'reach_out',
    filters: {
      category: 'All',
      dietary: 'All',
      search: '',
    },
  };

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage quota errors
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(val) {
    return '$' + Number(val || 0).toFixed(2);
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
  }

  async function apiRequest(action, options = {}) {
    const { method = 'GET', body = null } = options;
    const url = `api.php?action=${encodeURIComponent(action)}`;
    const fetchOpts = { method, headers: {} };
    if (body !== null) {
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(body);
    }
    const res = await fetch(url, fetchOpts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  // Expose lightweight helpers for track.js & admin.js
  window.AureliaApp = {
    escapeHtml,
    money,
    showToast,
    apiRequest,
    FALLBACK_IMG,
    getRecentOrderIds: () => loadJson(STORAGE_ORDERS_KEY, []),
  };

  /* ------------------------------------------------------------------------
     Banner if opened directly over file://
     ------------------------------------------------------------------------ */
  function checkFileProtocol() {
    if (window.location.protocol !== 'file:') return;
    const banner = document.createElement('div');
    banner.className = 'file-mode-banner';
    banner.innerHTML =
      'Previewing static files via <code>file://</code>. To enable live PHP orders, menu CMS, inventory &amp; tracking, run <code>php -S 127.0.0.1:8080</code> or double-click <code>start-server.bat</code>.';
    document.body.prepend(banner);
  }

  /* ------------------------------------------------------------------------
     Mobile Nav & Footer Year
     ------------------------------------------------------------------------ */
  function initNavigation() {
    const btn = document.getElementById('mobile-menu-btn');
    const nav = document.getElementById('main-nav');
    if (btn && nav) {
      btn.addEventListener('click', () => {
        const isOpen = nav.classList.toggle('open');
        btn.setAttribute('aria-expanded', String(isOpen));
      });
    }
    const yearEl = document.getElementById('current-year');
    if (yearEl) {
      yearEl.textContent = String(new Date().getFullYear());
    }
  }

  /* ------------------------------------------------------------------------
     Shared Cart Drawer + Order Confirmation Modal Mounting
     ------------------------------------------------------------------------ */
  function mountCartUI() {
    if (document.getElementById('cart-drawer')) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="drawer-backdrop hidden" id="drawer-backdrop" aria-hidden="true"></div>
      <aside class="cart-drawer" id="cart-drawer" aria-label="Your Order Cart" aria-hidden="true">
        <div class="drawer-header">
          <div>
            <h3>Your Order</h3>
            <span class="drawer-subtitle" id="drawer-item-summary">0 items</span>
          </div>
          <button type="button" class="icon-close-btn" id="cart-close-btn" aria-label="Close order cart">✕</button>
        </div>

        <div class="drawer-body-scroll">
          <div class="fulfillment-toggle" role="group" aria-label="Fulfillment Method">
            <button type="button" class="fulfill-btn active" data-mode="pickup">
              Curbside Pickup <span>Free · ~20m</span>
            </button>
            <button type="button" class="fulfill-btn" data-mode="delivery">
              Local Delivery <span id="delivery-fee-label">$4.50 · ~35m</span>
            </button>
          </div>

          <div class="cart-items-list" id="cart-items"></div>

          <div class="cart-section-box" id="delivery-fields-box">
            <h4>Delivery &amp; Timing Details</h4>
            <div id="delivery-address-wrap" class="hidden">
              <input type="text" id="delivery-address" placeholder="Street address, apt/suite *" />
            </div>
            <select id="delivery-window" aria-label="Preferred delivery or pickup window">
              <option value="ASAP">ASAP (Kitchen standard timing)</option>
              <option value="In 45 mins">In ~45 minutes</option>
              <option value="In 60 mins">In ~1 hour</option>
              <option value="Tonight 7:30 PM">Tonight 7:30 PM</option>
              <option value="Tonight 8:30 PM">Tonight 8:30 PM</option>
            </select>
            <textarea id="delivery-instructions" rows="2" placeholder="Gate code, drop-off notes, allergies, or curbside car model..."></textarea>
          </div>

          <div class="cart-section-box">
            <h4>Contact Details (So Our Team Can Reach Out)</h4>
            <input type="text" id="checkout-name" placeholder="Full Name *" />
            <input type="tel" id="checkout-phone" placeholder="Mobile Phone *" />
            <input type="email" id="checkout-email" placeholder="Email for receipt &amp; tracking link (optional)" />
          </div>

          <div class="cart-section-box">
            <h4>Promo &amp; Kitchen Team Tip</h4>
            <div class="promo-row">
              <input type="text" id="promo-input" placeholder="Promo code (try AURELIA10)" />
              <button type="button" class="btn btn-outline btn-sm" id="apply-promo-btn">Apply</button>
            </div>
            <small id="promo-feedback" style="color: var(--olive); font-weight: 600;"></small>
            <div class="tip-pills" id="tip-pills">
              <button type="button" class="tip-btn" data-tip="0">No Tip</button>
              <button type="button" class="tip-btn active" data-tip="10">10%</button>
              <button type="button" class="tip-btn" data-tip="15">15%</button>
              <button type="button" class="tip-btn" data-tip="20">20%</button>
            </div>
          </div>

          <div class="cart-section-box">
            <h4>Payment Option</h4>
            <div id="payment-options-list" style="display:grid; gap:0.5rem;">
              <label class="payment-option-card selected" data-method="reach_out">
                <input type="radio" name="payment_method" value="reach_out" checked />
                <div>
                  <strong>Pay on Confirmation (Staff Reaches Out)</strong>
                  <small>Send your order straight to Aurelia; our host calls/texts to finalize payment &amp; ETA.</small>
                </div>
              </label>
              <label class="payment-option-card" data-method="pay_on_arrival">
                <input type="radio" name="payment_method" value="pay_on_arrival" />
                <div>
                  <strong>Cash or Card on Delivery / Pickup</strong>
                  <small>Pay when your order arrives or at our State St curbside bay.</small>
                </div>
              </label>
              <label class="payment-option-card" data-method="gateway_card" id="gateway-option-card">
                <input type="radio" name="payment_method" value="gateway_card" />
                <div>
                  <strong id="gateway-option-title">Online Card / Gateway (Demo Ready)</strong>
                  <small id="gateway-option-note">Simulated instant card payment; plug in live Stripe/PayHere keys in Admin later.</small>
                </div>
              </label>
            </div>

            <div class="gateway-box hidden" id="gateway-card-fields">
              <strong style="color:var(--accent-hover);">Gateway Demo Card Input (Test Mode)</strong>
              <input type="text" id="gw-card-number" value="4242 •••• •••• 4242" maxlength="19" placeholder="Card Number" />
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
                <input type="text" id="gw-card-exp" value="12/28" placeholder="MM/YY" />
                <input type="text" id="gw-card-cvc" value="842" placeholder="CVC" />
              </div>
            </div>
          </div>
        </div>

        <div class="drawer-footer">
          <div class="totals-breakdown">
            <div class="total-line"><span>Subtotal</span><span id="cart-subtotal">$0.00</span></div>
            <div class="total-line hidden" id="discount-row"><span>Promo Discount</span><span id="cart-discount">-$0.00</span></div>
            <div class="total-line hidden" id="delivery-row"><span>Local Delivery</span><span id="cart-delivery-fee">$4.50</span></div>
            <div class="total-line"><span>Kitchen Tip</span><span id="cart-tip">$0.00</span></div>
            <div class="total-line"><span>Tax</span><span id="cart-tax">$0.00</span></div>
            <div class="total-line grand-total"><span>Total</span><span id="cart-total">$0.00</span></div>
          </div>
          <p class="form-error hidden" id="checkout-error" style="margin:0.5rem 0 0;"></p>
          <button type="button" class="btn btn-primary btn-full" id="checkout-btn" style="margin-top:0.75rem;">Place Order</button>
        </div>
      </aside>

      <div class="modal-backdrop hidden" id="order-modal" role="dialog" aria-modal="true" aria-labelledby="order-modal-title">
        <div class="modal-card" style="text-align:center;">
          <div class="confirm-icon" aria-hidden="true">✓</div>
          <p class="eyebrow">Order Sent to Kitchen</p>
          <h2 id="order-modal-title">Order <span id="order-number"></span></h2>
          <p id="order-eta-text" style="color:var(--text-muted); margin-top:0.4rem;"></p>
          <div class="modal-summary" id="order-summary-details"></div>
          <div style="display:flex; flex-wrap:wrap; gap:0.65rem;">
            <a href="track.html" class="btn btn-primary" id="modal-track-link" style="flex:1;">Track Live Delivery Roadmap →</a>
            <button type="button" class="btn btn-outline" id="close-order-modal-btn">Continue Browsing</button>
          </div>
        </div>
      </div>

      <div class="toast hidden" id="toast" role="status" aria-live="polite"></div>
    `;
    document.body.appendChild(wrapper);
  }

  function openCart() {
    const drawer = document.getElementById('cart-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (!drawer || !backdrop) return;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.classList.remove('hidden');
  }

  function closeCart() {
    const drawer = document.getElementById('cart-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (!drawer || !backdrop) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.classList.add('hidden');
  }

  function bindCartEvents() {
    document.getElementById('cart-open-btn')?.addEventListener('click', openCart);
    document.getElementById('cart-close-btn')?.addEventListener('click', closeCart);
    document.getElementById('drawer-backdrop')?.addEventListener('click', closeCart);

    document.querySelectorAll('.fulfill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.fulfillmentMode = btn.dataset.mode === 'delivery' ? 'delivery' : 'pickup';
        document.querySelectorAll('.fulfill-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document.getElementById('delivery-address-wrap')?.classList.toggle('hidden', state.fulfillmentMode !== 'delivery');
        renderCart();
      });
    });

    document.querySelectorAll('.tip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tipPercent = Number(btn.dataset.tip || 0);
        document.querySelectorAll('.tip-btn').forEach((b) => b.classList.toggle('active', b === btn));
        renderCart();
      });
    });

    document.querySelectorAll('input[name="payment_method"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        state.paymentMethod = radio.value;
        document.querySelectorAll('.payment-option-card').forEach((card) => {
          card.classList.toggle('selected', card.dataset.method === state.paymentMethod);
        });
        document.getElementById('gateway-card-fields')?.classList.toggle('hidden', state.paymentMethod !== 'gateway_card');
      });
    });

    document.getElementById('apply-promo-btn')?.addEventListener('click', () => {
      const code = (document.getElementById('promo-input')?.value || '').trim().toUpperCase();
      const feedback = document.getElementById('promo-feedback');
      if (code === 'AURELIA10') {
        state.promoCode = 'AURELIA10';
        state.promoRate = 0.1;
        if (feedback) feedback.textContent = '10% discount applied (AURELIA10).';
      } else if (code === 'WELCOME15') {
        state.promoCode = 'WELCOME15';
        state.promoRate = 0.15;
        if (feedback) feedback.textContent = '15% discount applied (WELCOME15).';
      } else {
        state.promoCode = '';
        state.promoRate = 0;
        if (feedback) feedback.textContent = 'Try AURELIA10 or WELCOME15.';
      }
      renderCart();
    });

    document.getElementById('copy-promo-btn')?.addEventListener('click', () => {
      const promoInput = document.getElementById('promo-input');
      if (promoInput) promoInput.value = 'AURELIA10';
      state.promoCode = 'AURELIA10';
      state.promoRate = 0.1;
      const feedback = document.getElementById('promo-feedback');
      if (feedback) feedback.textContent = '10% discount applied (AURELIA10).';
      renderCart();
      openCart();
      showToast('Promo AURELIA10 applied!');
    });

    document.getElementById('checkout-btn')?.addEventListener('click', handleCheckoutSubmit);

    document.getElementById('close-order-modal-btn')?.addEventListener('click', () => {
      document.getElementById('order-modal')?.classList.add('hidden');
    });
  }

  function getMenuItem(id) {
    return state.menu.find((m) => Number(m.id) === Number(id));
  }

  function addToCart(id, delta = 1) {
    const item = getMenuItem(id);
    if (!item) return;
    if (!item.available || Number(item.stock) <= 0) {
      showToast(`${item.name} is currently sold out.`);
      return;
    }

    const existing = state.cart.find((c) => Number(c.id) === Number(id));
    const currentQty = existing ? existing.qty : 0;
    const nextQty = currentQty + delta;

    if (nextQty > Number(item.stock)) {
      showToast(`Only ${item.stock} ${item.unit || 'portions'} available for ${item.name}.`);
      return;
    }

    if (nextQty <= 0) {
      state.cart = state.cart.filter((c) => Number(c.id) !== Number(id));
    } else if (existing) {
      existing.qty = nextQty;
      existing.price = Number(item.price);
      existing.name = item.name;
    } else {
      state.cart.push({
        id: Number(item.id),
        name: item.name,
        price: Number(item.price),
        qty: nextQty,
      });
    }

    saveJson(STORAGE_CART_KEY, state.cart);
    renderCart();
    renderMenus();
    if (delta > 0 && currentQty === 0) {
      showToast(`Added ${item.name} to your order.`);
    }
  }

  function renderCart() {
    const badge = document.getElementById('cart-count');
    const summaryEl = document.getElementById('drawer-item-summary');
    const listEl = document.getElementById('cart-items');

    // Sync cart prices/availability against live menu if loaded
    if (state.menu.length > 0) {
      state.cart = state.cart
        .map((c) => {
          const live = getMenuItem(c.id);
          if (!live || !live.available || live.stock <= 0) return null;
          return {
            id: live.id,
            name: live.name,
            price: Number(live.price),
            qty: Math.min(c.qty, Number(live.stock)),
          };
        })
        .filter(Boolean);
      saveJson(STORAGE_CART_KEY, state.cart);
    }

    const totalItems = state.cart.reduce((acc, c) => acc + c.qty, 0);
    if (badge) badge.textContent = String(totalItems);
    if (summaryEl) summaryEl.textContent = `${totalItems} ${totalItems === 1 ? 'item' : 'items'}`;

    if (listEl) {
      if (state.cart.length === 0) {
        listEl.innerHTML = `<p style="color:var(--text-muted); font-size:0.9rem; margin:0.5rem 0;">Your cart is empty. Browse our <a href="menu.html" style="text-decoration:underline; font-weight:700;">Evening Menu</a> to add wood-fired dishes.</p>`;
      } else {
        listEl.innerHTML = state.cart
          .map(
            (c) => `
          <div class="cart-item-row">
            <div class="cart-item-meta">
              <strong>${escapeHtml(c.name)}</strong>
              <small>${money(c.price)} each</small>
            </div>
            <div class="cart-item-controls">
              <div class="qty-inline">
                <button type="button" data-cart-dec="${c.id}" aria-label="Decrease quantity">−</button>
                <span>${c.qty}</span>
                <button type="button" data-cart-inc="${c.id}" aria-label="Increase quantity">+</button>
              </div>
              <strong style="min-width:56px; text-align:right;">${money(c.price * c.qty)}</strong>
            </div>
          </div>`
          )
          .join('');

        listEl.querySelectorAll('[data-cart-dec]').forEach((b) =>
          b.addEventListener('click', () => addToCart(Number(b.dataset.cartDec), -1))
        );
        listEl.querySelectorAll('[data-cart-inc]').forEach((b) =>
          b.addEventListener('click', () => addToCart(Number(b.dataset.cartInc), 1))
        );
      }
    }

    const subtotal = state.cart.reduce((acc, c) => acc + c.price * c.qty, 0);
    const discount = Number((subtotal * state.promoRate).toFixed(2));
    const deliveryFee =
      state.cart.length > 0 && state.fulfillmentMode === 'delivery'
        ? Number(state.settings.delivery_fee ?? 4.5)
        : 0;
    const tip = Number((subtotal * (state.tipPercent / 100)).toFixed(2));
    const taxRate = Number(state.settings.tax_rate ?? 0.0875);
    const tax = Number((Math.max(0, subtotal - discount) * taxRate).toFixed(2));
    const total = Math.max(0, subtotal - discount) + deliveryFee + tip + tax;

    const setTxt = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setTxt('cart-subtotal', money(subtotal));
    setTxt('cart-discount', `-${money(discount)}`);
    setTxt('cart-delivery-fee', money(deliveryFee));
    setTxt('cart-tip', money(tip));
    setTxt('cart-tax', money(tax));
    setTxt('cart-total', money(total));

    document.getElementById('discount-row')?.classList.toggle('hidden', discount <= 0);
    document.getElementById('delivery-row')?.classList.toggle('hidden', deliveryFee <= 0);

    // Update gateway UI visibility from backend settings
    const gw = state.settings.payment_gateway || {};
    const gwCard = document.getElementById('gateway-option-card');
    if (gwCard) {
      gwCard.classList.toggle('hidden', gw.enabled === false);
      const gwTitle = document.getElementById('gateway-option-title');
      const gwNote = document.getElementById('gateway-option-note');
      if (gwTitle && gw.label) gwTitle.textContent = gw.label;
      if (gwNote && gw.checkout_note) gwNote.textContent = gw.checkout_note;
    }
  }

  async function handleCheckoutSubmit() {
    const errEl = document.getElementById('checkout-error');
    const btn = document.getElementById('checkout-btn');
    const showErr = (msg) => {
      if (!errEl) return;
      errEl.textContent = msg;
      errEl.classList.toggle('hidden', !msg);
    };

    showErr('');
    if (state.cart.length === 0) {
      showErr('Add at least one dish before placing an order.');
      return;
    }

    const name = (document.getElementById('checkout-name')?.value || '').trim();
    const phone = (document.getElementById('checkout-phone')?.value || '').trim();
    const email = (document.getElementById('checkout-email')?.value || '').trim();
    const address = (document.getElementById('delivery-address')?.value || '').trim();
    const instructions = (document.getElementById('delivery-instructions')?.value || '').trim();
    const windowPref = document.getElementById('delivery-window')?.value || 'ASAP';

    if (!name || !phone) {
      showErr('Please enter your name and mobile number so our staff can reach out.');
      return;
    }
    if (state.fulfillmentMode === 'delivery' && !address) {
      showErr('Please enter your delivery street address.');
      return;
    }

    const subtotal = state.cart.reduce((acc, c) => acc + c.price * c.qty, 0);
    const tip = Number((subtotal * (state.tipPercent / 100)).toFixed(2));
    const cardNum = document.getElementById('gw-card-number')?.value || '4242';

    btn.disabled = true;
    btn.textContent = 'Sending Order...';

    try {
      const res = await apiRequest('order_create', {
        method: 'POST',
        body: {
          customer: { name, phone, email },
          fulfillment_mode: state.fulfillmentMode,
          delivery: { address, instructions, window: windowPref },
          items: state.cart.map((c) => ({ id: c.id, qty: c.qty })),
          promo_code: state.promoCode,
          tip,
          payment_method: state.paymentMethod,
          gateway_payload: { card_last4: cardNum.slice(-4) },
        },
      });

      const order = res.order;
      // Save recent order ID locally for quick access on track.html
      const recent = loadJson(STORAGE_ORDERS_KEY, []);
      if (!recent.includes(order.id)) {
        recent.unshift(order.id);
        saveJson(STORAGE_ORDERS_KEY, recent.slice(0, 8));
      }

      // Clear cart and refresh menu inventory
      state.cart = [];
      saveJson(STORAGE_CART_KEY, []);
      await fetchMenu();
      renderCart();
      closeCart();

      // Open Confirmation Modal
      document.getElementById('order-number').textContent = order.id;
      document.getElementById('order-eta-text').textContent =
        order.payment.status === 'paid_online'
          ? `Payment authorized (${order.payment.transaction_id}). Estimated time: ~${order.delivery_details.eta_minutes} mins.`
          : `Order received! Our team can reach out at ${order.customer.phone}. Estimated time: ~${order.delivery_details.eta_minutes} mins.`;

      const summaryEl = document.getElementById('order-summary-details');
      if (summaryEl) {
        summaryEl.innerHTML = `
          <div><strong>Fulfillment:</strong> ${escapeHtml(order.fulfillment_mode === 'delivery' ? 'Local Delivery' : 'Curbside Pickup')}</div>
          <div><strong>Destination:</strong> ${escapeHtml(order.delivery_details.address)}</div>
          <div><strong>Payment:</strong> ${escapeHtml(order.payment.method_label)} (${escapeHtml(order.payment.status.replace(/_/g, ' '))})</div>
          <div><strong>Total:</strong> ${money(order.pricing.total)}</div>
        `;
      }
      const trackLink = document.getElementById('modal-track-link');
      if (trackLink) trackLink.href = `track.html?id=${encodeURIComponent(order.id)}`;

      document.getElementById('order-modal')?.classList.remove('hidden');
    } catch (err) {
      showErr(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Place Order';
    }
  }

  /* ------------------------------------------------------------------------
     Menu Loading & Rendering (index.html featured & menu.html full)
     ------------------------------------------------------------------------ */
  async function fetchMenu() {
    try {
      const data = await apiRequest('menu');
      state.menu = Array.isArray(data.items) ? data.items : [];
      if (data.settings) {
        state.settings = { ...state.settings, ...data.settings };
      }
      const feeLabel = document.getElementById('delivery-fee-label');
      if (feeLabel) {
        feeLabel.textContent = `${money(state.settings.delivery_fee)} · ~${state.settings.delivery_eta_min}m`;
      }
      renderMenus();
      renderCart();
    } catch {
      const grid = document.getElementById('menu-grid') || document.getElementById('featured-menu-grid');
      if (grid && state.menu.length === 0) {
        grid.innerHTML = `<div class="card-panel" style="grid-column:1/-1;">Unable to load live menu from <code>api.php</code>. Start the PHP server (<code>php -S 127.0.0.1:8080</code>) to connect the backend.</div>`;
      }
    }
  }

  function renderDishCard(item) {
    const stock = Number(item.stock ?? 0);
    const thresh = Number(item.low_stock_threshold ?? 5);
    const soldOut = !item.available || stock <= 0;
    const inCart = state.cart.find((c) => Number(c.id) === Number(item.id));
    const cartQty = inCart ? inCart.qty : 0;

    let stockLabel = `${stock} left`;
    let stockClass = '';
    if (soldOut) {
      stockLabel = 'Sold Out';
      stockClass = 'out';
    } else if (stock <= thresh) {
      stockLabel = `Only ${stock} left`;
      stockClass = 'low';
    }

    const badgesHtml = (item.badges || [])
      .map((b) => `<span class="badge">${escapeHtml(b)}</span>`)
      .join('');

    const actionHtml = soldOut
      ? `<button type="button" class="btn btn-outline btn-sm" disabled>Unavailable</button>`
      : cartQty > 0
      ? `<div class="qty-inline">
           <button type="button" data-dec-id="${item.id}" aria-label="Remove one">−</button>
           <span>${cartQty}</span>
           <button type="button" data-inc-id="${item.id}" aria-label="Add one">+</button>
         </div>`
      : `<button type="button" class="btn btn-primary btn-sm" data-add-id="${item.id}">+ Add to Order</button>`;

    return `
      <article class="dish-card ${soldOut ? 'is-sold-out' : ''}">
        <div class="dish-media">
          <img src="${escapeHtml(item.image || FALLBACK_IMG)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'" />
          <div class="dish-badges">${badgesHtml}</div>
          <span class="stock-corner-pill ${stockClass}">${escapeHtml(stockLabel)}</span>
        </div>
        <div class="dish-body">
          <div class="dish-top">
            <h3 class="dish-title">${escapeHtml(item.name)}</h3>
            <span class="dish-price">${money(item.price)}</span>
          </div>
          <p class="dish-desc">${escapeHtml(item.description)}</p>
          <div class="dish-actions">
            <span style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(item.category)}</span>
            ${actionHtml}
          </div>
        </div>
      </article>
    `;
  }

  function bindMenuCardClicks(container) {
    container.querySelectorAll('[data-add-id], [data-inc-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.addId || btn.dataset.incId);
        addToCart(id, 1);
      });
    });
    container.querySelectorAll('[data-dec-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.decId);
        addToCart(id, -1);
      });
    });
  }

  function renderMenus() {
    // 1. Featured grid on index.html
    const featuredGrid = document.getElementById('featured-menu-grid');
    if (featuredGrid) {
      const featured = state.menu.filter((m) => m.featured).slice(0, 4);
      const list = featured.length ? featured : state.menu.slice(0, 4);
      featuredGrid.innerHTML = list.map(renderDishCard).join('');
      bindMenuCardClicks(featuredGrid);
    }

    // 2. Full menu grid on menu.html
    const fullGrid = document.getElementById('menu-grid');
    if (fullGrid) {
      const filtered = state.menu.filter((item) => {
        if (state.filters.category !== 'All' && item.category !== state.filters.category) return false;
        if (state.filters.dietary !== 'All' && !(item.badges || []).includes(state.filters.dietary)) return false;
        if (state.filters.search) {
          const q = state.filters.search.toLowerCase();
          const hay = `${item.name} ${item.description} ${item.category} ${(item.badges || []).join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      const countEl = document.getElementById('menu-result-count');
      if (countEl) countEl.textContent = `Showing ${filtered.length} of ${state.menu.length} dishes`;

      const resetBtn = document.getElementById('reset-filters-btn');
      if (resetBtn) {
        const hasFilter =
          state.filters.category !== 'All' || state.filters.dietary !== 'All' || state.filters.search !== '';
        resetBtn.classList.toggle('hidden', !hasFilter);
      }

      if (filtered.length === 0) {
        fullGrid.innerHTML = `<div class="card-panel" style="grid-column:1/-1; text-align:center;">No dishes matched your current filters.</div>`;
      } else {
        fullGrid.innerHTML = filtered.map(renderDishCard).join('');
        bindMenuCardClicks(fullGrid);
      }
    }
  }

  function initMenuFilters() {
    document.querySelectorAll('#category-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.category = btn.dataset.category || 'All';
        document.querySelectorAll('#category-tabs .tab-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', String(b === btn));
        });
        renderMenus();
      });
    });

    document.querySelectorAll('#dietary-pills .pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.dietary = btn.dataset.dietary || 'All';
        document.querySelectorAll('#dietary-pills .pill-btn').forEach((b) => b.classList.toggle('active', b === btn));
        renderMenus();
      });
    });

    document.getElementById('menu-search')?.addEventListener('input', (e) => {
      state.filters.search = e.target.value.trim();
      renderMenus();
    });

    document.getElementById('reset-filters-btn')?.addEventListener('click', () => {
      state.filters = { category: 'All', dietary: 'All', search: '' };
      const searchEl = document.getElementById('menu-search');
      if (searchEl) searchEl.value = '';
      document.querySelectorAll('#category-tabs .tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      document.querySelectorAll('#dietary-pills .pill-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      renderMenus();
    });
  }

  /* ------------------------------------------------------------------------
     Reservations Page (reservations.html)
     ------------------------------------------------------------------------ */
  function initReservationsPage() {
    const form = document.getElementById('reservation-form');
    if (!form) return;

    const dateInput = document.getElementById('res-date');
    if (dateInput) {
      const today = new Date().toISOString().split('T')[0];
      dateInput.min = today;
      if (!dateInput.value) dateInput.value = today;
    }

    document.querySelectorAll('#time-slots .slot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#time-slots .slot-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('res-time').value = btn.dataset.time;
      });
    });

    document.querySelectorAll('#seating-options .seating-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#seating-options .seating-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('res-seating').value = btn.dataset.seating;
      });
    });

    document.getElementById('book-another-btn')?.addEventListener('click', () => {
      document.getElementById('res-confirmation')?.classList.add('hidden');
      form.classList.remove('hidden');
      form.reset();
      if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('res-error');
      errEl.textContent = '';

      const payload = {
        date: document.getElementById('res-date').value,
        time: document.getElementById('res-time').value,
        guests: Number(document.getElementById('res-guests').value),
        seating: document.getElementById('res-seating').value,
        name: document.getElementById('res-name').value.trim(),
        phone: document.getElementById('res-phone').value.trim(),
        email: document.getElementById('res-email').value.trim(),
        notes: document.getElementById('res-notes').value.trim(),
      };

      try {
        const res = await apiRequest('reservation_create', { method: 'POST', body: payload });
        const savedIds = loadJson(STORAGE_RES_KEY, []);
        savedIds.unshift(res.reservation.id);
        saveJson(STORAGE_RES_KEY, savedIds.slice(0, 10));

        form.classList.add('hidden');
        document.getElementById('res-confirmation').classList.remove('hidden');
        document.getElementById('res-confirm-summary').textContent =
          `Confirmation ${res.reservation.id}: ${res.reservation.guests} guests on ${res.reservation.date} at ${res.reservation.time} (${res.reservation.seating}).`;
        loadSavedReservations();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    loadSavedReservations();
  }

  async function loadSavedReservations() {
    const container = document.getElementById('saved-reservations');
    const countEl = document.getElementById('saved-res-count');
    if (!container) return;

    const ids = loadJson(STORAGE_RES_KEY, []);
    if (ids.length === 0) {
      if (countEl) countEl.textContent = '0';
      container.innerHTML = `<p style="color:var(--text-muted); font-size:0.88rem;">No upcoming bookings yet from this browser.</p>`;
      return;
    }

    try {
      const data = await apiRequest(`reservation_lookup&ids=${encodeURIComponent(ids.join(','))}`);
      const list = data.reservations || [];
      if (countEl) countEl.textContent = String(list.length);
      if (list.length === 0) {
        container.innerHTML = `<p style="color:var(--text-muted); font-size:0.88rem;">No matching bookings found.</p>`;
        return;
      }
      container.innerHTML = list
        .map(
          (r) => `
        <div class="saved-res-card">
          <div class="saved-res-top">
            <strong>${escapeHtml(r.id)} · ${escapeHtml(r.date)} at ${escapeHtml(r.time)}</strong>
            <span class="badge badge-olive">${escapeHtml(r.status)}</span>
          </div>
          <div style="font-size:0.85rem; color:var(--text-muted);">
            ${escapeHtml(r.guests)} Guests · ${escapeHtml(r.seating)}<br/>
            ${escapeHtml(r.name)} (${escapeHtml(r.phone)})
          </div>
        </div>`
        )
        .join('');
    } catch {
      container.innerHTML = `<p style="color:var(--text-muted); font-size:0.88rem;">Connect PHP server to sync bookings.</p>`;
    }
  }

  /* ------------------------------------------------------------------------
     About / Private Events Inquiry Form (about.html)
     ------------------------------------------------------------------------ */
  function initInquiryForm() {
    const form = document.getElementById('inquiry-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('inquiry-status');
      statusEl.textContent = '';
      try {
        await apiRequest('inquiry_create', {
          method: 'POST',
          body: {
            name: document.getElementById('inq-name').value.trim(),
            email: document.getElementById('inq-email').value.trim(),
            phone: document.getElementById('inq-phone').value.trim(),
            topic: document.getElementById('inq-topic').value,
            message: document.getElementById('inq-message').value.trim(),
          },
        });
        form.reset();
        statusEl.style.color = 'var(--olive)';
        statusEl.textContent = 'Thank you! Your inquiry is logged for our events coordinator.';
        showToast('Inquiry received!');
      } catch (err) {
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = err.message;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    checkFileProtocol();
    initNavigation();
    mountCartUI();
    bindCartEvents();
    initMenuFilters();
    initReservationsPage();
    initInquiryForm();
    fetchMenu();
  });
})();
