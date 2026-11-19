/**
 * Aurelia Coastal Kitchen — Shared Front-End Application Logic
 * Connects multi-page UI to PHP backend (api.php).
 */
(() => {
  'use strict';

  const STORAGE_CART_KEY = 'aurelia_cart_v2';
  const STORAGE_ORDERS_KEY = 'aurelia_recent_orders_v2';
  const STORAGE_RES_KEY = 'aurelia_my_reservations_v2';
  const STORAGE_STATIC_DB = 'aurelia_static_db_v1';
  const DEMO_ADMIN_TOKEN = 'aurelia2026';
  let useStaticFallback = window.location.protocol === 'file:';

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

  function getRoadmapStages(mode = 'delivery') {
    if (mode === 'pickup') {
      return [
        { key: 'received', label: 'Order Received', detail: 'Kitchen logged your ticket and notified the host stand.' },
        { key: 'preparing', label: 'Cooking on the Hearth', detail: 'Chefs are firing your dishes fresh over white oak.' },
        { key: 'packing', label: 'Quality & Packing', detail: 'Checking dish temperatures, garnishes, and warm bread.' },
        { key: 'ready_for_pickup', label: 'Ready for Pickup', detail: 'Waiting at the State Street host stand / curbside bay.' },
        { key: 'delivered', label: 'Picked Up', detail: 'Order handed off — enjoy your evening!' },
      ];
    }
    return [
      { key: 'received', label: 'Order Received', detail: 'Ticket confirmed and queued for the kitchen pass.' },
      { key: 'preparing', label: 'Cooking on the Hearth', detail: 'Chefs are grilling and plating your order fresh.' },
      { key: 'packing', label: 'Packed for Transit', detail: 'Sealed in insulated thermal boxes with chilled dressings separate.' },
      { key: 'out_for_delivery', label: 'Out for Delivery', detail: 'Aurelia courier is on the way to your drop-off point.' },
      { key: 'delivered', label: 'Delivered', detail: 'Delivered to your door — thank you for ordering!' },
    ];
  }

  async function ensureStaticDb() {
    let db = loadJson(STORAGE_STATIC_DB, null);
    if (db && Array.isArray(db.menu) && db.menu.length > 0) {
      return db;
    }

    const fetchStaticJson = async (path, fallback) => {
      try {
        const res = await fetch(path);
        if (!res.ok) return fallback;
        return await res.json();
      } catch {
        return fallback;
      }
    };

    const [menu, orders, reservations, inventory_log, settings, inquiries] = await Promise.all([
      fetchStaticJson('data/menu.json', []),
      fetchStaticJson('data/orders.json', []),
      fetchStaticJson('data/reservations.json', []),
      fetchStaticJson('data/inventory_log.json', []),
      fetchStaticJson('data/settings.json', state.settings),
      fetchStaticJson('data/inquiries.json', []),
    ]);

    db = { menu, orders, reservations, inventory_log, settings, inquiries };
    saveJson(STORAGE_STATIC_DB, db);
    return db;
  }

  function assertStaticAdmin(token) {
    if (token !== DEMO_ADMIN_TOKEN) {
      const err = new Error('Unauthorized: Invalid staff passkey.');
      err.status = 401;
      throw err;
    }
  }

  async function localApiFallback(rawAction, options = {}) {
    const { method = 'GET', body = null, token = '', isFormData = false } = options;
    const ampIdx = rawAction.indexOf('&');
    const action = ampIdx === -1 ? rawAction : rawAction.slice(0, ampIdx);
    const params = new URLSearchParams(ampIdx === -1 ? '' : rawAction.slice(ampIdx + 1));
    const db = await ensureStaticDb();
    const now = new Date().toISOString();

    if (method === 'GET') {
      if (action === 'ping') return { success: true, mode: 'static' };
      if (action === 'menu') return { success: true, items: db.menu, settings: db.settings };

      if (action === 'track') {
        const orderId = (params.get('id') || '').trim().toUpperCase();
        const found = (db.orders || []).find((o) => String(o.id).toUpperCase() === orderId);
        if (!found) throw new Error(`Order ${orderId} was not found.`);
        return { success: true, order: found, stages: getRoadmapStages(found.fulfillment_mode) };
      }

      if (action === 'reservation_lookup') {
        const wanted = (params.get('ids') || '')
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        const matched = (db.reservations || []).filter((r) => wanted.includes(String(r.id).toUpperCase()));
        return { success: true, reservations: matched };
      }

      if (action === 'admin_bootstrap') {
        assertStaticAdmin(token);
        let gross = 0;
        let paid = 0;
        let pending = 0;
        let active = 0;
        (db.orders || []).forEach((o) => {
          const total = Number(o.pricing?.total || 0);
          const pStat = o.payment?.status || 'pending_contact';
          if (o.status !== 'cancelled') {
            gross += total;
            if (pStat === 'paid_online' || pStat === 'paid_in_person') paid += total;
            else if (pStat !== 'refunded') pending += total;
            if (o.status !== 'delivered') active++;
          }
        });
        let low = 0;
        let out = 0;
        (db.menu || []).forEach((m) => {
          if (Number(m.stock) <= 0 || !m.available) out++;
          else if (Number(m.stock) <= Number(m.low_stock_threshold || 5)) low++;
        });
        return {
          success: true,
          menu: db.menu,
          orders: db.orders,
          reservations: db.reservations,
          inventory_log: db.inventory_log,
          inquiries: db.inquiries,
          settings: db.settings,
          roadmap_meta: {
            delivery: getRoadmapStages('delivery'),
            pickup: getRoadmapStages('pickup'),
          },
          metrics: {
            gross_revenue: Number(gross.toFixed(2)),
            paid_revenue: Number(paid.toFixed(2)),
            pending_revenue: Number(pending.toFixed(2)),
            active_orders: active,
            total_orders: db.orders.length,
            low_stock_count: low,
            out_of_stock_count: out,
            reservations_count: db.reservations.length,
          },
        };
      }
      throw new Error('Unknown GET action.');
    }

    // POST actions in static mode
    if (action === 'upload_image' && isFormData) {
      assertStaticAdmin(token);
      const file = body.get('image');
      if (!file) throw new Error('No image selected.');
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });
      return { success: true, url: dataUrl };
    }

    const payload = body || {};

    if (action === 'admin_login') {
      if (payload.passkey !== DEMO_ADMIN_TOKEN) {
        const err = new Error('Invalid passkey. Try aurelia2026 for demo access.');
        err.status = 401;
        throw err;
      }
      return { success: true, token: DEMO_ADMIN_TOKEN };
    }

    if (action === 'order_create') {
      const c = payload.customer || {};
      if (!c.name || !c.phone) throw new Error('Customer name and phone number are required.');
      const mode = payload.fulfillment_mode === 'delivery' ? 'delivery' : 'pickup';
      if (mode === 'delivery' && !payload.delivery?.address) {
        throw new Error('Delivery street address is required.');
      }
      const reqItems = payload.items || [];
      if (!reqItems.length) throw new Error('Your cart is empty.');

      let subtotal = 0;
      const orderItems = [];
      const deductions = [];
      reqItems.forEach((req) => {
        const idx = db.menu.findIndex((m) => Number(m.id) === Number(req.id));
        if (idx === -1) throw new Error(`Menu item #${req.id} not found.`);
        const dish = db.menu[idx];
        const qty = Math.max(1, Number(req.qty || 1));
        if (!dish.available || Number(dish.stock) <= 0) throw new Error(`${dish.name} is sold out.`);
        if (Number(dish.stock) < qty) throw new Error(`Only ${dish.stock} left of ${dish.name}.`);
        subtotal += Number(dish.price) * qty;
        orderItems.push({ id: dish.id, sku: dish.sku || '', name: dish.name, price: Number(dish.price), qty });
        db.menu[idx].stock = Number(dish.stock) - qty;
        if (db.menu[idx].stock <= 0) {
          db.menu[idx].stock = 0;
          db.menu[idx].available = false;
        }
        deductions.push({ item_id: dish.id, item_name: dish.name, delta: -qty, new_stock: db.menu[idx].stock });
      });

      const code = String(payload.promo_code || '').toUpperCase();
      const rate = code === 'AURELIA10' ? 0.1 : code === 'WELCOME15' ? 0.15 : 0;
      const discount = Number((subtotal * rate).toFixed(2));
      const deliveryFee = mode === 'delivery' ? Number(db.settings.delivery_fee ?? 4.5) : 0;
      const tip = Math.max(0, Number(payload.tip || 0));
      const tax = Number((Math.max(0, subtotal - discount) * Number(db.settings.tax_rate ?? 0.0875)).toFixed(2));
      const total = Number((Math.max(0, subtotal - discount) + deliveryFee + tip + tax).toFixed(2));

      const pm = payload.payment_method || 'reach_out';
      const payment = {
        method: pm,
        method_label:
          pm === 'gateway_card'
            ? db.settings.payment_gateway?.label || 'Online Card / Gateway'
            : pm === 'pay_on_arrival'
            ? mode === 'delivery'
              ? 'Cash or Card on Delivery'
              : 'Cash or Card at Pickup'
            : 'Pay on Confirmation (Staff Reaches Out)',
        status: pm === 'gateway_card' ? 'paid_online' : pm === 'pay_on_arrival' ? 'pay_on_arrival' : 'pending_contact',
        provider: pm === 'gateway_card' ? db.settings.payment_gateway?.provider || 'stripe_ready' : 'manual',
        transaction_id: pm === 'gateway_card' ? 'GW-' + Math.random().toString(16).slice(2, 12).toUpperCase() : '',
        card_last4: pm === 'gateway_card' ? String(payload.gateway_payload?.card_last4 || '4242').slice(-4) : '',
      };

      const maxNum = db.orders.reduce((acc, o) => {
        const m = String(o.id).match(/AUR-(\d+)/);
        return m ? Math.max(acc, Number(m[1])) : acc;
      }, 1000);
      const orderId = `AUR-${maxNum + 1}`;
      const newOrder = {
        id: orderId,
        created_at: now,
        updated_at: now,
        customer: c,
        fulfillment_mode: mode,
        delivery_details: {
          address: mode === 'delivery' ? payload.delivery.address : 'Curbside Pickup — 418 State St',
          instructions: payload.delivery?.instructions || '',
          window: payload.delivery?.window || 'ASAP',
          courier_name: '',
          eta_minutes: mode === 'delivery' ? Number(db.settings.delivery_eta_min || 35) : Number(db.settings.prep_time_min || 20),
        },
        items: orderItems,
        pricing: { subtotal: Number(subtotal.toFixed(2)), promo_code: rate ? code : '', discount, delivery_fee: deliveryFee, tip, tax, total },
        payment,
        status: 'received',
        timeline: [{ stage: 'received', label: 'Order Received', at: now, note: 'Order received via storefront.' }],
        staff_notes: [],
      };

      db.orders.unshift(newOrder);
      deductions.forEach((d) =>
        db.inventory_log.unshift({ at: now, ...d, reason: 'Order Deduction', reference: orderId })
      );
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, order: newOrder, stages: getRoadmapStages(mode) };
    }

    if (action === 'order_customer_note') {
      const ord = db.orders.find((o) => String(o.id).toUpperCase() === String(payload.order_id || '').toUpperCase());
      if (!ord) throw new Error('Order not found.');
      ord.staff_notes.push({ at: now, author: 'Customer', text: String(payload.note || '') });
      ord.updated_at = now;
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, order: ord };
    }

    if (action === 'reservation_create') {
      const resObj = {
        id: `RES-${Math.floor(1000 + Math.random() * 9000)}`,
        ...payload,
        status: 'Confirmed',
        created_at: now,
      };
      db.reservations.unshift(resObj);
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, reservation: resObj };
    }

    if (action === 'inquiry_create') {
      const inq = { id: `INQ-${Math.floor(1000 + Math.random() * 9000)}`, ...payload, created_at: now };
      db.inquiries.unshift(inq);
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, inquiry: inq };
    }

    assertStaticAdmin(token);

    if (action === 'order_update') {
      const ord = db.orders.find((o) => String(o.id).toUpperCase() === String(payload.order_id || '').toUpperCase());
      if (!ord) throw new Error('Order not found.');
      const prevStatus = ord.status;
      if (payload.courier_name !== undefined) ord.delivery_details.courier_name = payload.courier_name;
      if (payload.eta_minutes !== undefined && payload.eta_minutes !== '') ord.delivery_details.eta_minutes = Number(payload.eta_minutes);
      if (payload.payment_status) ord.payment.status = payload.payment_status;
      if (payload.reach_out_note) ord.staff_notes.push({ at: now, author: 'Staff Outreach', text: payload.reach_out_note });

      const nextStatus = payload.status || prevStatus;
      if (nextStatus !== prevStatus || payload.stage_note) {
        if (nextStatus === 'cancelled' && prevStatus !== 'cancelled') {
          ord.items.forEach((oi) => {
            const dish = db.menu.find((m) => Number(m.id) === Number(oi.id));
            if (dish) {
              dish.stock = Number(dish.stock) + Number(oi.qty);
              if (dish.stock > 0) dish.available = true;
              db.inventory_log.unshift({ at: now, item_id: dish.id, item_name: dish.name, delta: oi.qty, new_stock: dish.stock, reason: 'Order Cancelled Restock', reference: ord.id });
            }
          });
        }
        const stages = [...getRoadmapStages(ord.fulfillment_mode), { key: 'cancelled', label: 'Order Cancelled' }];
        const match = stages.find((s) => s.key === nextStatus);
        ord.status = nextStatus;
        ord.timeline.push({ stage: nextStatus, label: match ? match.label : nextStatus, at: now, note: payload.stage_note || 'Status updated.' });
      }
      ord.updated_at = now;
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, order: ord };
    }

    if (action === 'menu_save') {
      const itemData = payload.item || payload;
      const id = Number(itemData.id || 0);
      const stock = Math.max(0, Number(itemData.stock ?? 15));
      const clean = {
        ...itemData,
        id,
        price: Number(itemData.price),
        stock,
        available: stock === 0 ? false : Boolean(itemData.available),
        badges: Array.isArray(itemData.badges)
          ? itemData.badges
          : String(itemData.badges || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
        updated_at: now,
      };
      const idx = db.menu.findIndex((m) => Number(m.id) === id);
      if (idx >= 0) {
        db.menu[idx] = clean;
      } else {
        clean.id = db.menu.reduce((max, m) => Math.max(max, Number(m.id)), 0) + 1;
        db.menu.unshift(clean);
      }
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, item: clean, menu: db.menu };
    }

    if (action === 'menu_delete') {
      db.menu = db.menu.filter((m) => Number(m.id) !== Number(payload.id));
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, menu: db.menu };
    }

    if (action === 'inventory_adjust') {
      const dish = db.menu.find((m) => Number(m.id) === Number(payload.id));
      if (!dish) throw new Error('Dish not found.');
      const prev = Number(dish.stock);
      const next = Math.max(0, prev + Number(payload.delta || 0));
      dish.stock = next;
      dish.available = next > 0;
      db.inventory_log.unshift({ at: now, item_id: dish.id, item_name: dish.name, delta: next - prev, new_stock: next, reason: payload.reason || 'Manual Adjustment', reference: 'INV-CTRL' });
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, item: dish, menu: db.menu };
    }

    if (action === 'reservation_update') {
      const resObj = db.reservations.find((r) => r.id === payload.id);
      if (!resObj) throw new Error('Reservation not found.');
      resObj.status = payload.status;
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, reservation: resObj };
    }

    if (action === 'settings_save') {
      const incoming = payload.settings || payload;
      db.settings = {
        ...db.settings,
        ...incoming,
        payment_gateway: { ...(db.settings.payment_gateway || {}), ...(incoming.payment_gateway || {}) },
      };
      saveJson(STORAGE_STATIC_DB, db);
      return { success: true, settings: db.settings };
    }

    throw new Error('Unknown POST action.');
  }

  async function apiRequest(action, options = {}) {
    const { method = 'GET', body = null, token = '', isFormData = false } = options;
    if (useStaticFallback) {
      return localApiFallback(action, options);
    }

    const url = `api.php?action=${encodeURIComponent(action)}`;
    const headers = {};
    if (token) headers['X-Admin-Token'] = token;
    const fetchOpts = { method, headers };
    if (body !== null) {
      if (isFormData) {
        fetchOpts.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        fetchOpts.body = JSON.stringify(body);
      }
    }

    try {
      const res = await fetch(url, fetchOpts);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        // Static hosting (e.g. GitHub Pages) returns raw PHP text or HTML 405 page
        useStaticFallback = true;
        return localApiFallback(action, options);
      }
      if (!res.ok || data.success === false) {
        const err = new Error(data.error || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (err) {
      if (err && typeof err.status === 'number') {
        throw err;
      }
      useStaticFallback = true;
      return localApiFallback(action, options);
    }
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
      'Local file preview detected. Run <code>start-server.bat</code> (or publish to GitHub Pages / a PHP host) so JSON menu data loads without browser file restrictions.';
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
          <button type="button" class="icon-close-btn" id="cart-close-btn" aria-label="Close order cart"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
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
          <div class="confirm-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
          <p class="eyebrow">Order Sent to Kitchen</p>
          <h2 id="order-modal-title">Order <span id="order-number"></span></h2>
          <p id="order-eta-text" style="color:var(--text-muted); margin-top:0.4rem;"></p>
          <div class="modal-summary" id="order-summary-details"></div>
          <div style="display:flex; flex-wrap:wrap; gap:0.65rem;">
            <a href="track.html" class="btn btn-primary" id="modal-track-link" style="flex:1;">Track Live Delivery Roadmap</a>
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
