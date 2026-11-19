# Aurelia — Wood-Fired Coastal Kitchen & Bar

A multi-page restaurant storefront, live order & delivery roadmap tracker, and PHP 8.4 staff backend for orders, inventory, menu management (CMS), reservations, and payment options.

## Quick Start (Local Demo)
1. Double-click `start-server.bat`, or run in terminal:
   ```powershell
   php -S 127.0.0.1:8080 -t "C:\Users\Kevin\.gemini\antigravity\scratch\aurelia-restaurant"
   ```
2. Open `http://127.0.0.1:8080/index.html` in your browser.
3. **Staff / Owner Backend Portal**: Open `http://127.0.0.1:8080/admin.html` and sign in with passkey `aurelia2026`.

## Pages
- `index.html` — Restaurant homepage, featured dishes (live from PHP), tasting menu, and reviews.
- `menu.html` — Full interactive menu with category tabs, dietary filters, search, live inventory stock badges, and slide-over checkout drawer.
- `reservations.html` — Table booking form & saved booking status synced with `api.php`.
- `track.html` — Customer Delivery Roadmap tracker (`AUR-1001`, `AUR-1002`, or newly placed orders) with 5-stage live progress, courier/ETA info, receipt, and guest message notes.
- `about.html` — Restaurant story, hours, location, and private dining inquiry form.
- `admin.html` — Staff & Owner portal for:
  - **Orders & Delivery Roadmap**: Customer phone/email reach-out links, courier assignment, ETA, roadmap stage advancement, and payment status tracking.
  - **Menu CMS**: Edit dish pricing, images (URL or local PHP file upload into `uploads/`), descriptions, badges, and availability anytime.
  - **Inventory Management**: Real-time automatic stock deduction on order placement, stock restoration on cancellation, quick restock buttons, and audit log.
  - **Payments & Gateway Settings**: Track Pay-on-Confirmation, Cash/Card on Arrival, and Online Gateway orders, plus plug-and-play gateway settings.

## Attaching a Live Payment Gateway Later
The checkout flow supports three options:
1. **Pay on Confirmation (Staff Reaches Out)** — customer submits order with phone/email so staff reaches out directly.
2. **Cash or Card on Delivery / Pickup** — collected in person.
3. **Online Card / Gateway (Demo Ready)** — routed through `aurelia_process_gateway_payment()` in `backend.php` and configured in Admin -> *Payments & Gateway Setup*. Replace the sandbox return in `aurelia_process_gateway_payment()` with your Stripe Checkout, PayHere, or Razorpay API call when ready to go live.
