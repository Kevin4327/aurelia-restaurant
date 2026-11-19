/**
 * Aurelia Coastal Kitchen — Live Order & Delivery Roadmap Tracker
 */
(() => {
  'use strict';

  let currentOrderId = null;
  let pollTimer = null;

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function paymentBadgeClass(status) {
    if (status === 'paid_online' || status === 'paid_in_person') return 'badge-olive';
    if (status === 'refunded') return 'badge-danger';
    return 'badge-warn';
  }

  function formatPaymentStatus(status) {
    const map = {
      pending_contact: 'Pending Confirmation (Staff Reaches Out)',
      payment_link_sent: 'Payment Link Sent',
      pay_on_arrival: 'Pay on Delivery / Pickup',
      paid_online: 'Paid Online (Gateway)',
      paid_in_person: 'Paid in Person',
      refunded: 'Refunded',
    };
    return map[status] || status;
  }

  async function loadOrder(orderId, silent = false) {
    const cleanId = (orderId || '').trim().toUpperCase();
    if (!cleanId) return;

    const { escapeHtml, money, apiRequest } = window.AureliaApp;
    const errorEl = document.getElementById('track-error');
    const resultEl = document.getElementById('track-result');

    if (!silent && errorEl) errorEl.classList.add('hidden');

    try {
      const data = await apiRequest(`track&id=${encodeURIComponent(cleanId)}`);
      const order = data.order;
      const stages = data.stages || [];
      currentOrderId = order.id;

      // Update URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.set('id', order.id);
      window.history.replaceState({}, '', url.toString());

      const input = document.getElementById('track-order-input');
      if (input) input.value = order.id;

      if (resultEl) resultEl.classList.remove('hidden');

      // Render Header & Courier Banner
      document.getElementById('track-order-title').textContent = `${order.id} · ${order.customer.name}`;
      document.getElementById('track-order-meta').textContent =
        `${order.fulfillment_mode === 'delivery' ? 'Local Delivery' : 'Curbside Pickup'} · Placed ${formatTime(order.created_at)}`;

      const payStatusEl = document.getElementById('track-payment-badge');
      payStatusEl.className = `badge ${paymentBadgeClass(order.payment.status)}`;
      payStatusEl.textContent = formatPaymentStatus(order.payment.status);

      const courierEl = document.getElementById('track-courier-banner');
      const details = order.delivery_details || {};
      if (order.status === 'cancelled') {
        courierEl.innerHTML = `
          <div>
            <strong style="color:var(--danger);">Order Cancelled</strong>
            <div style="font-size:0.84rem; color:var(--text-muted);">Any deducted menu inventory has been restored. Contact (805) 555-0192 with questions.</div>
          </div>
        `;
      } else if (order.status === 'delivered') {
        courierEl.innerHTML = `
          <div>
            <strong style="color:var(--olive);">Fulfillment Complete</strong>
            <div style="font-size:0.84rem; color:var(--text-muted);">Destination: ${escapeHtml(details.address)}</div>
          </div>
          <span class="badge badge-olive">Completed</span>
        `;
      } else {
        const courierText = details.courier_name
          ? `Assigned Courier: <strong>${escapeHtml(details.courier_name)}</strong>`
          : order.fulfillment_mode === 'delivery'
          ? 'Courier will be assigned once packing completes'
          : 'Curbside Host Team monitoring arrival';
        courierEl.innerHTML = `
          <div>
            <strong>${escapeHtml(details.address)}</strong>
            <div style="font-size:0.84rem; color:var(--text-muted);">${courierText} · Window: ${escapeHtml(details.window || 'ASAP')}</div>
            ${details.instructions ? `<div style="font-size:0.82rem; color:var(--accent-hover); margin-top:0.2rem;">Note: ${escapeHtml(details.instructions)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <span class="badge badge-olive">ETA ~${Number(details.eta_minutes || 25)} min</span>
          </div>
        `;
      }

      // Render Visual 5-Step Roadmap
      const timelineByStage = {};
      (order.timeline || []).forEach((t) => {
        timelineByStage[t.stage] = t;
      });

      const currentIdx = stages.findIndex((s) => s.key === order.status);
      const stepperEl = document.getElementById('roadmap-stepper');
      stepperEl.innerHTML = stages
        .map((stage, idx) => {
          let stateClass = '';
          let icon = String(idx + 1);
          if (order.status === 'cancelled') {
            stateClass = timelineByStage[stage.key] ? 'completed' : '';
            icon = timelineByStage[stage.key] ? '✓' : String(idx + 1);
          } else if (order.status === 'delivered' || idx < currentIdx) {
            stateClass = 'completed';
            icon = '✓';
          } else if (idx === currentIdx) {
            stateClass = 'active';
            icon = '●';
          }
          const logEntry = timelineByStage[stage.key];
          return `
            <div class="roadmap-step ${stateClass}">
              <div class="step-dot">${icon}</div>
              <div class="step-body">
                <h4>${escapeHtml(stage.label)}</h4>
                <p>${escapeHtml(logEntry?.note || stage.detail)}</p>
                ${logEntry ? `<span class="step-time">${escapeHtml(formatTime(logEntry.at))}</span>` : ''}
              </div>
            </div>
          `;
        })
        .join('');

      // Render Activity & Staff Outreach Feed
      const notesEl = document.getElementById('track-notes-feed');
      const allNotes = order.staff_notes || [];
      if (allNotes.length === 0) {
        notesEl.innerHTML = `<p style="font-size:0.84rem; color:var(--text-muted); margin:0;">No messages yet. Use the box below if you'd like to share gate updates or request a callback.</p>`;
      } else {
        notesEl.innerHTML = allNotes
          .map(
            (n) => `
          <div class="timeline-log-item">
            <div><strong>${escapeHtml(n.author)}:</strong> ${escapeHtml(n.text)}</div>
            <span style="color:var(--text-muted); white-space:nowrap;">${escapeHtml(formatTime(n.at))}</span>
          </div>`
          )
          .join('');
      }

      // Render Receipt & Payment Summary
      const receiptEl = document.getElementById('track-receipt-body');
      const p = order.pricing || {};
      receiptEl.innerHTML = `
        <div style="display:grid; gap:0.45rem; margin-bottom:1rem;">
          ${(order.items || [])
            .map(
              (i) => `
            <div style="display:flex; justify-content:space-between; font-size:0.9rem;">
              <span>${i.qty}× ${escapeHtml(i.name)}</span>
              <strong>${money(i.price * i.qty)}</strong>
            </div>`
            )
            .join('')}
        </div>
        <div class="totals-breakdown" style="border-top:1px solid var(--border); padding-top:0.75rem;">
          <div class="total-line"><span>Subtotal</span><span>${money(p.subtotal)}</span></div>
          ${p.discount > 0 ? `<div class="total-line"><span>Promo (${escapeHtml(p.promo_code)})</span><span>-${money(p.discount)}</span></div>` : ''}
          ${p.delivery_fee > 0 ? `<div class="total-line"><span>Delivery Fee</span><span>${money(p.delivery_fee)}</span></div>` : ''}
          ${p.tip > 0 ? `<div class="total-line"><span>Kitchen Tip</span><span>${money(p.tip)}</span></div>` : ''}
          <div class="total-line"><span>Tax</span><span>${money(p.tax)}</span></div>
          <div class="total-line grand-total"><span>Total</span><span>${money(p.total)}</span></div>
        </div>
        <div style="margin-top:1rem; padding:0.75rem; border-radius:8px; background:var(--bg-cream); font-size:0.84rem;">
          <div><strong>Payment Method:</strong> ${escapeHtml(order.payment.method_label)}</div>
          ${order.payment.transaction_id ? `<div><strong>Gateway Txn:</strong> <code>${escapeHtml(order.payment.transaction_id)}</code></div>` : ''}
          <div><strong>Customer Phone:</strong> ${escapeHtml(order.customer.phone)}</div>
        </div>
      `;

      // Auto-poll every 6 seconds if order is still in progress
      clearInterval(pollTimer);
      if (!['delivered', 'cancelled'].includes(order.status)) {
        pollTimer = setInterval(() => loadOrder(order.id, true), 6000);
      }
    } catch (err) {
      if (!silent) {
        if (resultEl) resultEl.classList.add('hidden');
        if (errorEl) {
          errorEl.textContent = err.message;
          errorEl.classList.remove('hidden');
        }
      }
    }
  }

  function renderOrderChips() {
    const container = document.getElementById('recent-order-chips');
    if (!container) return;
    const recent = window.AureliaApp.getRecentOrderIds();
    const combined = Array.from(new Set([...recent, 'AUR-1001', 'AUR-1002']));
    container.innerHTML = combined
      .map(
        (id) => `<button type="button" class="chip-btn" data-chip-id="${window.AureliaApp.escapeHtml(id)}">${window.AureliaApp.escapeHtml(id)}</button>`
      )
      .join('');
    container.querySelectorAll('[data-chip-id]').forEach((btn) => {
      btn.addEventListener('click', () => loadOrder(btn.dataset.chipId));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderOrderChips();

    document.getElementById('track-search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('track-order-input')?.value || '';
      loadOrder(val);
    });

    document.getElementById('customer-note-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentOrderId) return;
      const input = document.getElementById('customer-note-input');
      const note = (input?.value || '').trim();
      if (!note) return;
      try {
        await window.AureliaApp.apiRequest('order_customer_note', {
          method: 'POST',
          body: { order_id: currentOrderId, note },
        });
        input.value = '';
        window.AureliaApp.showToast('Note sent to Aurelia kitchen team!');
        loadOrder(currentOrderId, true);
      } catch (err) {
        window.AureliaApp.showToast(err.message);
      }
    });

    const params = new URLSearchParams(window.location.search);
    const initialId = params.get('id') || window.AureliaApp.getRecentOrderIds()[0] || 'AUR-1001';
    loadOrder(initialId);
  });
})();
