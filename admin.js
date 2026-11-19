/**
 * Aurelia Coastal Kitchen — Staff & Owner Backend Portal
 */
(() => {
  'use strict';

  const TOKEN_KEY = 'aurelia_admin_token';

  const adminState = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    data: null,
    activeTab: 'orders',
    orderFilter: 'all',
  };

  function escapeHtml(str) {
    return window.AureliaApp.escapeHtml(str);
  }

  function money(v) {
    return window.AureliaApp.money(v);
  }

  function showToast(msg) {
    window.AureliaApp.showToast(msg);
  }

  async function adminApi(action, options = {}) {
    const { method = 'GET', body = null, isFormData = false } = options;
    const url = `api.php?action=${encodeURIComponent(action)}`;
    const headers = {
      'X-Admin-Token': adminState.token,
    };
    const fetchOpts = { method, headers };
    if (body !== null) {
      if (isFormData) {
        fetchOpts.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        fetchOpts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(url, fetchOpts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      adminState.token = '';
      showLoginView();
    }
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Error (${res.status})`);
    }
    return data;
  }

  function showLoginView() {
    document.getElementById('admin-login-section')?.classList.remove('hidden');
    document.getElementById('admin-workspace')?.classList.add('hidden');
  }

  function showWorkspaceView() {
    document.getElementById('admin-login-section')?.classList.add('hidden');
    document.getElementById('admin-workspace')?.classList.remove('hidden');
  }

  async function loadDashboard() {
    if (!adminState.token) {
      showLoginView();
      return;
    }
    try {
      const data = await adminApi('admin_bootstrap');
      adminState.data = data;
      showWorkspaceView();
      renderKPIs();
      renderAllTabs();
    } catch (err) {
      showLoginView();
      const loginErr = document.getElementById('admin-login-error');
      if (loginErr) loginErr.textContent = err.message;
    }
  }

  function renderKPIs() {
    const m = adminState.data?.metrics || {};
    document.getElementById('kpi-gross').textContent = money(m.gross_revenue);
    document.getElementById('kpi-paid').textContent = money(m.paid_revenue);
    document.getElementById('kpi-pending').textContent = money(m.pending_revenue);
    document.getElementById('kpi-active-orders').textContent = String(m.active_orders || 0);
    document.getElementById('kpi-low-stock').textContent = `${m.low_stock_count || 0} / ${m.out_of_stock_count || 0}`;
  }

  function renderAllTabs() {
    renderOrdersTab();
    renderMenuCmsTab();
    renderInventoryTab();
    renderPaymentsTab();
    renderReservationsTab();
  }

  /* ------------------------------------------------------------------------
     TAB 1: Orders, Customer Reach-Out & Delivery Roadmap
     ------------------------------------------------------------------------ */
  function renderOrdersTab() {
    const container = document.getElementById('admin-orders-list');
    if (!container || !adminState.data) return;

    const orders = (adminState.data.orders || []).filter((o) => {
      if (adminState.orderFilter === 'active') return !['delivered', 'cancelled'].includes(o.status);
      if (adminState.orderFilter === 'pending_pay')
        return ['pending_contact', 'payment_link_sent', 'pay_on_arrival'].includes(o.payment?.status);
      if (adminState.orderFilter === 'completed') return ['delivered', 'cancelled'].includes(o.status);
      return true;
    });

    if (orders.length === 0) {
      container.innerHTML = `<div class="card-panel">No orders match the selected filter.</div>`;
      return;
    }

    const meta = adminState.data.roadmap_meta || {};

    container.innerHTML = orders
      .map((o) => {
        const mode = o.fulfillment_mode === 'pickup' ? 'pickup' : 'delivery';
        const stages = [...(meta[mode] || []), { key: 'cancelled', label: 'Cancelled' }];
        const details = o.delivery_details || {};
        const pay = o.payment || {};

        const payBadgeClass =
          pay.status === 'paid_online' || pay.status === 'paid_in_person'
            ? 'badge-olive'
            : pay.status === 'refunded'
            ? 'badge-danger'
            : 'badge-warn';

        const notesHtml = (o.staff_notes || [])
          .map(
            (n) =>
              `<div style="font-size:0.8rem; padding:0.35rem 0.6rem; border-radius:6px; background:var(--bg-cream);"><strong>${escapeHtml(n.author)}:</strong> ${escapeHtml(n.text)}</div>`
          )
          .join('');

        return `
          <article class="admin-order-card" data-order-id="${escapeHtml(o.id)}">
            <div class="admin-order-head">
              <div>
                <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.5rem;">
                  <strong style="font-size:1.1rem;">${escapeHtml(o.id)}</strong>
                  <span class="badge">${mode === 'delivery' ? 'Delivery' : 'Curbside Pickup'}</span>
                  <span class="badge ${payBadgeClass}">${escapeHtml(pay.status.replace(/_/g, ' '))}</span>
                  ${pay.transaction_id ? `<code style="font-size:0.78rem;">${escapeHtml(pay.transaction_id)}</code>` : ''}
                </div>
                <div style="margin-top:0.4rem; font-size:0.9rem;">
                  <strong>${escapeHtml(o.customer.name)}</strong> ·
                  <a href="tel:${escapeHtml(o.customer.phone)}" style="color:var(--accent-hover); font-weight:700; text-decoration:underline;">📞 ${escapeHtml(o.customer.phone)}</a>
                  ${o.customer.email ? `· <a href="mailto:${escapeHtml(o.customer.email)}" style="text-decoration:underline;">✉ ${escapeHtml(o.customer.email)}</a>` : ''}
                </div>
                <div style="font-size:0.83rem; color:var(--text-muted); margin-top:0.2rem;">
                  📍 ${escapeHtml(details.address)} · Window: ${escapeHtml(details.window || 'ASAP')}
                  ${details.instructions ? `<br/>📝 <em>${escapeHtml(details.instructions)}</em>` : ''}
                </div>
              </div>

              <div style="text-align:right;">
                <strong style="font-size:1.25rem;">${money(o.pricing?.total)}</strong>
                <div style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(pay.method_label)}</div>
                <a href="track.html?id=${encodeURIComponent(o.id)}" target="_blank" class="btn btn-outline btn-xs" style="margin-top:0.4rem;">Guest Tracker ↗</a>
              </div>
            </div>

            <div style="font-size:0.86rem; display:flex; flex-wrap:wrap; gap:0.5rem 1.25rem;">
              ${(o.items || []).map((i) => `<span><strong>${i.qty}×</strong> ${escapeHtml(i.name)} (${money(i.price * i.qty)})</span>`).join('')}
            </div>

            ${notesHtml ? `<div style="display:grid; gap:0.35rem;">${notesHtml}</div>` : ''}

            <div class="admin-order-controls">
              <div>
                <label>Delivery Roadmap Stage</label>
                <select class="ord-status-select">
                  ${stages
                    .map(
                      (s) =>
                        `<option value="${escapeHtml(s.key)}" ${o.status === s.key ? 'selected' : ''}>${escapeHtml(s.label)}</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div>
                <label>Payment Status</label>
                <select class="ord-pay-select">
                  <option value="pending_contact" ${pay.status === 'pending_contact' ? 'selected' : ''}>Pending Contact (Reach Out)</option>
                  <option value="payment_link_sent" ${pay.status === 'payment_link_sent' ? 'selected' : ''}>Payment Link Sent</option>
                  <option value="pay_on_arrival" ${pay.status === 'pay_on_arrival' ? 'selected' : ''}>Pay on Delivery/Pickup</option>
                  <option value="paid_online" ${pay.status === 'paid_online' ? 'selected' : ''}>Paid Online (Gateway)</option>
                  <option value="paid_in_person" ${pay.status === 'paid_in_person' ? 'selected' : ''}>Paid in Person</option>
                  <option value="refunded" ${pay.status === 'refunded' ? 'selected' : ''}>Refunded</option>
                </select>
              </div>
              <div>
                <label>Courier / Driver Name</label>
                <input type="text" class="ord-courier-input" value="${escapeHtml(details.courier_name || '')}" placeholder="e.g. Mateo R." />
              </div>
              <div>
                <label>ETA (mins)</label>
                <input type="number" min="0" class="ord-eta-input" value="${Number(details.eta_minutes ?? 20)}" />
              </div>
              <div>
                <label>Staff Reach-Out / Timeline Note</label>
                <input type="text" class="ord-note-input" placeholder="e.g. Called guest, confirmed arrival" />
              </div>
              <div>
                <button type="button" class="btn btn-primary btn-sm btn-full ord-save-btn">Save &amp; Update</button>
              </div>
            </div>
          </article>
        `;
      })
      .join('');

    container.querySelectorAll('.ord-save-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.admin-order-card');
        const orderId = card.dataset.orderId;
        const noteVal = card.querySelector('.ord-note-input').value.trim();

        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
          await adminApi('order_update', {
            method: 'POST',
            body: {
              order_id: orderId,
              status: card.querySelector('.ord-status-select').value,
              payment_status: card.querySelector('.ord-pay-select').value,
              courier_name: card.querySelector('.ord-courier-input').value.trim(),
              eta_minutes: card.querySelector('.ord-eta-input').value,
              stage_note: noteVal,
              reach_out_note: noteVal,
            },
          });
          showToast(`Updated ${orderId}`);
          await loadDashboard();
        } catch (err) {
          showToast(err.message);
          btn.disabled = false;
          btn.textContent = 'Save & Update';
        }
      });
    });
  }

  /* ------------------------------------------------------------------------
     TAB 2: Menu CMS (Add / Edit Pricing, Images, Descriptions, Availability)
     ------------------------------------------------------------------------ */
  function renderMenuCmsTab() {
    const tbody = document.getElementById('admin-menu-tbody');
    if (!tbody || !adminState.data) return;

    const menu = adminState.data.menu || [];
    tbody.innerHTML = menu
      .map(
        (m) => `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <img src="${escapeHtml(m.image)}" alt="" style="width:48px; height:48px; object-fit:cover; border-radius:8px; background:#eee;" onerror="this.src='${window.AureliaApp.FALLBACK_IMG}'" />
            <div>
              <strong>${escapeHtml(m.name)}</strong>
              <div style="font-size:0.76rem; color:var(--text-muted);">${escapeHtml(m.category)} · ${escapeHtml(m.sku || '')}</div>
            </div>
          </div>
        </td>
        <td><strong>${money(m.price)}</strong></td>
        <td>${Number(m.stock)} ${escapeHtml(m.unit || 'portions')}</td>
        <td>
          ${
            m.available && m.stock > 0
              ? `<span class="badge badge-olive">Available</span>`
              : `<span class="badge badge-danger">Sold Out</span>`
          }
          ${m.featured ? `<span class="badge" style="margin-left:0.25rem;">Featured</span>` : ''}
        </td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-outline btn-xs cms-edit-btn" data-id="${m.id}">Edit</button>
          <button type="button" class="btn btn-danger-outline btn-xs cms-del-btn" data-id="${m.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.cms-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = menu.find((x) => Number(x.id) === Number(btn.dataset.id));
        if (!item) return;
        document.getElementById('cms-form-title').textContent = `Edit Dish: ${item.name}`;
        document.getElementById('cms-id').value = item.id;
        document.getElementById('cms-name').value = item.name;
        document.getElementById('cms-category').value = item.category;
        document.getElementById('cms-sku').value = item.sku || '';
        document.getElementById('cms-price').value = item.price;
        document.getElementById('cms-stock').value = item.stock;
        document.getElementById('cms-unit').value = item.unit || 'portions';
        document.getElementById('cms-threshold').value = item.low_stock_threshold || 5;
        document.getElementById('cms-image').value = item.image || '';
        document.getElementById('cms-desc').value = item.description || '';
        document.getElementById('cms-badges').value = (item.badges || []).join(', ');
        document.getElementById('cms-available').checked = Boolean(item.available);
        document.getElementById('cms-featured').checked = Boolean(item.featured);
        document.getElementById('cms-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    tbody.querySelectorAll('.cms-del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this dish from the menu?')) return;
        try {
          await adminApi('menu_delete', {
            method: 'POST',
            body: { id: Number(btn.dataset.id) },
          });
          showToast('Dish deleted.');
          await loadDashboard();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  function resetCmsForm() {
    document.getElementById('cms-form-title').textContent = 'Add New Menu Dish';
    document.getElementById('cms-form')?.reset();
    document.getElementById('cms-id').value = '';
    document.getElementById('cms-available').checked = true;
  }

  /* ------------------------------------------------------------------------
     TAB 3: Inventory Management & Audit Log
     ------------------------------------------------------------------------ */
  function renderInventoryTab() {
    const tbody = document.getElementById('admin-inv-tbody');
    const logBody = document.getElementById('admin-inv-log-tbody');
    if (!tbody || !adminState.data) return;

    const menu = adminState.data.menu || [];
    tbody.innerHTML = menu
      .map((m) => {
        const stock = Number(m.stock || 0);
        const thresh = Number(m.low_stock_threshold || 5);
        let statusBadge = `<span class="badge badge-olive">Healthy</span>`;
        if (stock <= 0 || !m.available) {
          statusBadge = `<span class="badge badge-danger">Out of Stock</span>`;
        } else if (stock <= thresh) {
          statusBadge = `<span class="badge badge-warn">Low Stock (&le;${thresh})</span>`;
        }

        return `
          <tr>
            <td><strong>${escapeHtml(m.name)}</strong><div style="font-size:0.76rem; color:var(--text-muted);">${escapeHtml(m.sku || '')} · ${escapeHtml(m.category)}</div></td>
            <td><strong>${stock}</strong> ${escapeHtml(m.unit || 'portions')}</td>
            <td>${thresh}</td>
            <td>${statusBadge}</td>
            <td style="white-space:nowrap;">
              <button type="button" class="btn btn-outline btn-xs inv-delta-btn" data-id="${m.id}" data-delta="-1">−1</button>
              <button type="button" class="btn btn-outline btn-xs inv-delta-btn" data-id="${m.id}" data-delta="5">+5</button>
              <button type="button" class="btn btn-primary btn-xs inv-delta-btn" data-id="${m.id}" data-delta="15">+15 Restock</button>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('.inv-delta-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const delta = Number(btn.dataset.delta);
        try {
          await adminApi('inventory_adjust', {
            method: 'POST',
            body: {
              id: Number(btn.dataset.id),
              delta,
              reason: delta > 0 ? 'Kitchen Restock' : 'Manual Adjustment',
            },
          });
          showToast('Inventory updated');
          await loadDashboard();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    if (logBody) {
      const logs = adminState.data.inventory_log || [];
      logBody.innerHTML = logs
        .slice(0, 40)
        .map(
          (l) => `
        <tr>
          <td style="font-size:0.8rem; white-space:nowrap;">${escapeHtml(new Date(l.at).toLocaleString())}</td>
          <td>${escapeHtml(l.item_name)}</td>
          <td style="font-weight:700; color:${l.delta < 0 ? 'var(--danger)' : 'var(--olive)'};">${l.delta > 0 ? '+' + l.delta : l.delta}</td>
          <td><strong>${l.new_stock}</strong></td>
          <td>${escapeHtml(l.reason)} <code>${escapeHtml(l.reference)}</code></td>
        </tr>
      `
        )
        .join('');
    }
  }

  /* ------------------------------------------------------------------------
     TAB 4: Payments & Gateway Settings
     ------------------------------------------------------------------------ */
  function renderPaymentsTab() {
    if (!adminState.data) return;
    const settings = adminState.data.settings || {};
    const gw = settings.payment_gateway || {};
    const orders = adminState.data.orders || [];

    const byMethod = { reach_out: 0, pay_on_arrival: 0, gateway_card: 0 };
    orders.forEach((o) => {
      if (o.status === 'cancelled') return;
      const m = o.payment?.method || 'reach_out';
      byMethod[m] = (byMethod[m] || 0) + Number(o.pricing?.total || 0);
    });

    document.getElementById('pay-summary-reachout').textContent = money(byMethod.reach_out);
    document.getElementById('pay-summary-arrival').textContent = money(byMethod.pay_on_arrival);
    document.getElementById('pay-summary-gateway').textContent = money(byMethod.gateway_card);

    // Populate settings form
    document.getElementById('set-accepting').checked = settings.accepting_orders !== false;
    document.getElementById('set-prep-min').value = settings.prep_time_min ?? 20;
    document.getElementById('set-deliv-min').value = settings.delivery_eta_min ?? 35;
    document.getElementById('set-deliv-fee').value = settings.delivery_fee ?? 4.5;

    document.getElementById('gw-enabled').checked = gw.enabled !== false;
    document.getElementById('gw-provider').value = gw.provider || 'stripe_ready';
    document.getElementById('gw-mode').value = gw.mode || 'sandbox';
    document.getElementById('gw-label').value = gw.label || 'Online Card / Gateway (Demo Ready)';
    document.getElementById('gw-pubkey').value = gw.public_key || '';
    document.getElementById('gw-webhook').value = gw.webhook_url || '';
    document.getElementById('gw-note').value = gw.checkout_note || '';
  }

  /* ------------------------------------------------------------------------
     TAB 5: Reservations & Inquiries
     ------------------------------------------------------------------------ */
  function renderReservationsTab() {
    const resBody = document.getElementById('admin-res-tbody');
    const inqBody = document.getElementById('admin-inq-tbody');
    if (!adminState.data) return;

    if (resBody) {
      const reservations = adminState.data.reservations || [];
      resBody.innerHTML = reservations
        .map(
          (r) => `
        <tr>
          <td><strong>${escapeHtml(r.id)}</strong></td>
          <td>${escapeHtml(r.date)} · ${escapeHtml(r.time)}</td>
          <td>${escapeHtml(r.name)}<div style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(r.phone)} · ${escapeHtml(r.email)}</div></td>
          <td>${r.guests} · ${escapeHtml(r.seating)}</td>
          <td>${escapeHtml(r.notes || '—')}</td>
          <td>
            <select class="res-status-sel" data-id="${escapeHtml(r.id)}" style="padding:0.35rem 0.5rem; border-radius:6px; border:1px solid var(--border);">
              ${['Confirmed', 'Seated', 'Completed', 'Cancelled']
                .map((st) => `<option value="${st}" ${r.status === st ? 'selected' : ''}>${st}</option>`)
                .join('')}
            </select>
          </td>
        </tr>
      `
        )
        .join('');

      resBody.querySelectorAll('.res-status-sel').forEach((sel) => {
        sel.addEventListener('change', async () => {
          try {
            await adminApi('reservation_update', {
              method: 'POST',
              body: { id: sel.dataset.id, status: sel.value },
            });
            showToast(`Reservation ${sel.dataset.id} -> ${sel.value}`);
            await loadDashboard();
          } catch (err) {
            showToast(err.message);
          }
        });
      });
    }

    if (inqBody) {
      const inquiries = adminState.data.inquiries || [];
      if (inquiries.length === 0) {
        inqBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);">No private event inquiries yet.</td></tr>`;
      } else {
        inqBody.innerHTML = inquiries
          .map(
            (i) => `
          <tr>
            <td><strong>${escapeHtml(i.id)}</strong><div style="font-size:0.76rem; color:var(--text-muted);">${escapeHtml(new Date(i.created_at).toLocaleDateString())}</div></td>
            <td>${escapeHtml(i.name)}<div style="font-size:0.78rem;">${escapeHtml(i.phone)} ${escapeHtml(i.email)}</div></td>
            <td><span class="badge">${escapeHtml(i.topic)}</span></td>
            <td>${escapeHtml(i.message)}</td>
          </tr>
        `
          )
          .join('');
      }
    }
  }

  /* ------------------------------------------------------------------------
     Init Event Bindings
     ------------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('admin-login-error');
      errEl.textContent = '';
      const passkey = document.getElementById('admin-passkey').value;
      try {
        const res = await window.AureliaApp.apiRequest('admin_login', {
          method: 'POST',
          body: { passkey },
        });
        adminState.token = res.token;
        sessionStorage.setItem(TOKEN_KEY, res.token);
        await loadDashboard();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    document.getElementById('admin-logout-btn')?.addEventListener('click', () => {
      sessionStorage.removeItem(TOKEN_KEY);
      adminState.token = '';
      showLoginView();
    });

    document.getElementById('admin-refresh-btn')?.addEventListener('click', loadDashboard);

    // Admin Tabs
    document.querySelectorAll('#admin-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        adminState.activeTab = tab;
        document.querySelectorAll('#admin-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.admin-tab-panel').forEach((panel) => {
          panel.classList.toggle('hidden', panel.id !== `tab-${tab}`);
        });
      });
    });

    // Order Filters
    document.querySelectorAll('#order-filter-pills .pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.orderFilter = btn.dataset.filter;
        document.querySelectorAll('#order-filter-pills .pill-btn').forEach((b) => b.classList.toggle('active', b === btn));
        renderOrdersTab();
      });
    });

    // Menu CMS Submit & Image Upload
    document.getElementById('cms-upload-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('image', file);
      try {
        showToast('Uploading image...');
        const res = await adminApi('upload_image', { method: 'POST', body: fd, isFormData: true });
        document.getElementById('cms-image').value = res.url;
        showToast('Image uploaded! Save dish to apply.');
      } catch (err) {
        showToast(err.message);
      }
    });

    document.getElementById('cms-reset-btn')?.addEventListener('click', resetCmsForm);

    document.getElementById('cms-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await adminApi('menu_save', {
          method: 'POST',
          body: {
            item: {
              id: Number(document.getElementById('cms-id').value || 0),
              name: document.getElementById('cms-name').value.trim(),
              category: document.getElementById('cms-category').value,
              sku: document.getElementById('cms-sku').value.trim(),
              price: Number(document.getElementById('cms-price').value),
              stock: Number(document.getElementById('cms-stock').value),
              unit: document.getElementById('cms-unit').value.trim(),
              low_stock_threshold: Number(document.getElementById('cms-threshold').value || 5),
              image: document.getElementById('cms-image').value.trim(),
              description: document.getElementById('cms-desc').value.trim(),
              badges: document.getElementById('cms-badges').value,
              available: document.getElementById('cms-available').checked,
              featured: document.getElementById('cms-featured').checked,
            },
          },
        });
        showToast('Menu dish saved!');
        resetCmsForm();
        await loadDashboard();
      } catch (err) {
        showToast(err.message);
      }
    });

    // Gateway & Store Settings Form
    document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await adminApi('settings_save', {
          method: 'POST',
          body: {
            settings: {
              accepting_orders: document.getElementById('set-accepting').checked,
              prep_time_min: Number(document.getElementById('set-prep-min').value),
              delivery_eta_min: Number(document.getElementById('set-deliv-min').value),
              delivery_fee: Number(document.getElementById('set-deliv-fee').value),
              payment_gateway: {
                enabled: document.getElementById('gw-enabled').checked,
                provider: document.getElementById('gw-provider').value,
                mode: document.getElementById('gw-mode').value,
                label: document.getElementById('gw-label').value.trim(),
                public_key: document.getElementById('gw-pubkey').value.trim(),
                webhook_url: document.getElementById('gw-webhook').value.trim(),
                checkout_note: document.getElementById('gw-note').value.trim(),
              },
            },
          },
        });
        showToast('Payment gateway & store settings saved!');
        await loadDashboard();
      } catch (err) {
        showToast(err.message);
      }
    });

    loadDashboard();
  });
})();
