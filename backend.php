<?php
/**
 * Aurelia Restaurant — Core Backend Helpers, Seed Store & Gateway Adapter
 */
declare(strict_types=1);

function aurelia_init_store(array $config): void
{
    $dataDir = $config['data_dir'];
    $uploadsDir = $config['uploads_dir'];

    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0775, true);
    }
    if (!is_dir($uploadsDir)) {
        mkdir($uploadsDir, 0775, true);
    }

    $seedFiles = [
        'menu.json'          => aurelia_seed_menu(),
        'settings.json'      => aurelia_seed_settings($config),
        'orders.json'        => aurelia_seed_orders(),
        'reservations.json'  => aurelia_seed_reservations(),
        'inventory_log.json' => aurelia_seed_inventory_log(),
        'inquiries.json'     => [],
        'users.json'         => aurelia_seed_users(),
    ];

    foreach ($seedFiles as $filename => $defaultData) {
        $path = $dataDir . DIRECTORY_SEPARATOR . $filename;
        if (!file_exists($path)) {
            aurelia_write_json($path, $defaultData);
        }
    }
}

function aurelia_data_path(array $config, string $filename): string
{
    return $config['data_dir'] . DIRECTORY_SEPARATOR . $filename;
}

function aurelia_read_json(string $path, array $default = []): array
{
    if (!file_exists($path)) {
        return $default;
    }
    $fp = fopen($path, 'rb');
    if ($fp === false) {
        return $default;
    }
    flock($fp, LOCK_SH);
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    if ($raw === false || trim($raw) === '') {
        return $default;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : $default;
}

function aurelia_write_json(string $path, array $data): bool
{
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        return false;
    }
    $tmpPath = $path . '.tmp.' . bin2hex(random_bytes(4));
    $written = file_put_contents($tmpPath, $json, LOCK_EX);
    if ($written === false) {
        @unlink($tmpPath);
        return false;
    }
    return rename($tmpPath, $path);
}

function aurelia_roadmap_stages(string $mode = 'delivery'): array
{
    if ($mode === 'pickup') {
        return [
            ['key' => 'received',         'label' => 'Order Received',       'detail' => 'Kitchen logged your ticket and notified the host stand.'],
            ['key' => 'preparing',        'label' => 'Cooking on the Hearth', 'detail' => 'Chefs are firing your dishes fresh over white oak.'],
            ['key' => 'packing',          'label' => 'Quality & Packing',    'detail' => 'Checking dish temperatures, garnishes, and warm bread.'],
            ['key' => 'ready_for_pickup', 'label' => 'Ready for Pickup',     'detail' => 'Waiting at the State Street host stand / curbside bay.'],
            ['key' => 'delivered',        'label' => 'Picked Up',            'detail' => 'Order handed off — enjoy your evening!'],
        ];
    }

    return [
        ['key' => 'received',         'label' => 'Order Received',        'detail' => 'Ticket confirmed and queued for the kitchen pass.'],
        ['key' => 'preparing',        'label' => 'Cooking on the Hearth', 'detail' => 'Chefs are grilling and plating your order fresh.'],
        ['key' => 'packing',          'label' => 'Packed for Transit',    'detail' => 'Sealed in insulated thermal boxes with chilled dressings separate.'],
        ['key' => 'out_for_delivery', 'label' => 'Out for Delivery',      'detail' => 'Aurelia courier is on the way to your drop-off point.'],
        ['key' => 'delivered',        'label' => 'Delivered',             'detail' => 'Delivered to your door — thank you for ordering!'],
    ];
}

function aurelia_process_gateway_payment(array $settings, float $amount, array $payload): array
{
    $gateway = $settings['payment_gateway'] ?? [];
    $provider = (string)($gateway['provider'] ?? 'demo_sandbox');
    $enabled = (bool)($gateway['enabled'] ?? true);

    if (!$enabled) {
        return [
            'ok' => false,
            'error' => 'Online payment gateway is currently disabled. Please select Pay on Confirmation or Cash/Card on Delivery.',
        ];
    }

    $last4 = preg_replace('/\D+/', '', (string)($payload['card_last4'] ?? '4242'));
    $last4 = substr($last4 ?: '4242', -4);

    return [
        'ok'             => true,
        'provider'       => $provider,
        'transaction_id' => 'GW-' . strtoupper(substr(bin2hex(random_bytes(5)), 0, 10)),
        'payment_status' => 'paid_online',
        'card_last4'     => $last4,
        'amount'         => round($amount, 2),
        'captured_at'    => gmdate('c'),
        'mode'           => (string)($gateway['mode'] ?? 'sandbox'),
    ];
}

function aurelia_append_inventory_log(array $config, array $entry): void
{
    $logPath = aurelia_data_path($config, 'inventory_log.json');
    $logs = aurelia_read_json($logPath, []);
    array_unshift($logs, $entry);
    // Keep latest 300 movement entries
    $logs = array_slice($logs, 0, 300);
    aurelia_write_json($logPath, $logs);
}

function aurelia_public_settings(array $settings): array
{
    $safe = $settings;
    if (isset($safe['payment_gateway']['secret_key_hint'])) {
        // Keep only non-secret display hints
    }
    unset($safe['payment_gateway']['secret_key']);
    return $safe;
}

function aurelia_seed_settings(array $config): array
{
    return [
        'restaurant_name'  => $config['restaurant_name'],
        'accepting_orders' => true,
        'prep_time_min'    => 20,
        'delivery_eta_min' => 35,
        'delivery_fee'     => $config['delivery_fee'],
        'tax_rate'         => $config['tax_rate'],
        'contact_phone'    => '(805) 555-0192',
        'contact_email'    => 'hello@aureliakitchen.com',
        'payment_gateway'  => [
            'enabled'        => true,
            'provider'       => 'stripe_ready',
            'mode'           => 'sandbox',
            'label'          => 'Card / Digital Wallet (Gateway Ready)',
            'public_key'     => 'pk_test_aurelia_demo_connect_later',
            'webhook_url'    => 'https://yourdomain.com/api.php?action=gateway_webhook',
            'checkout_note'  => 'Demo test checkout enabled now; swap in live Stripe, PayHere, or custom gateway keys anytime in Admin.',
        ],
    ];
}

function aurelia_seed_menu(): array
{
    $now = gmdate('c');
    return [
        [
            'id' => 1,
            'sku' => 'STR-001',
            'name' => 'Charred Octopus & Smoked Chickpea',
            'category' => 'Starters',
            'price' => 22.00,
            'description' => 'Wood-roasted Spanish octopus, warm chickpea purée, pickled fennel, and Meyer lemon chili oil.',
            'image' => 'https://images.unsplash.com/photo-1551248429-40975aa4de74?auto=format&fit=crop&w=900&q=80',
            'badges' => ["Chef's Special", 'Gluten-Free'],
            'featured' => true,
            'available' => true,
            'stock' => 18,
            'low_stock_threshold' => 5,
            'unit' => 'portions',
            'updated_at' => $now,
        ],
        [
            'id' => 2,
            'sku' => 'STR-002',
            'name' => 'Burrata & Ember-Roasted Peaches',
            'category' => 'Starters',
            'price' => 19.00,
            'description' => 'Pugliese burrata, charred stone fruit, basil oil, toasted pistachios, and grilled country sourdough.',
            'image' => 'https://images.unsplash.com/photo-1608897013039-887f21d8c804?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Vegetarian'],
            'featured' => false,
            'available' => true,
            'stock' => 22,
            'low_stock_threshold' => 6,
            'unit' => 'portions',
            'updated_at' => $now,
        ],
        [
            'id' => 3,
            'sku' => 'STR-003',
            'name' => 'Local Halibut Crudo',
            'category' => 'Starters',
            'price' => 21.00,
            'description' => 'Channel Islands halibut shaved thin with blood orange, castelvetrano olives, sea salt, and fennel pollen.',
            'image' => 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Gluten-Free'],
            'featured' => true,
            'available' => true,
            'stock' => 14,
            'low_stock_threshold' => 4,
            'unit' => 'portions',
            'updated_at' => $now,
        ],
        [
            'id' => 4,
            'sku' => 'STR-004',
            'name' => 'Whipped Ricotta & Heirloom Focaccia',
            'category' => 'Starters',
            'price' => 15.00,
            'description' => 'House-cultured sheep milk ricotta, rosemary sea-salt focaccia, and wildflower honeycomb.',
            'image' => 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Vegetarian'],
            'featured' => false,
            'available' => true,
            'stock' => 25,
            'low_stock_threshold' => 6,
            'unit' => 'orders',
            'updated_at' => $now,
        ],
        [
            'id' => 5,
            'sku' => 'WFM-001',
            'name' => 'Whole Oak-Roasted Mediterranean Branzino',
            'category' => 'Wood-Fired Mains',
            'price' => 42.00,
            'description' => 'Crispy-skin sea bass roasted over white oak with caper-lemon brown butter, charred broccolini, and herb salad.',
            'image' => 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=900&q=80',
            'badges' => ["Chef's Special", 'Gluten-Free'],
            'featured' => true,
            'available' => true,
            'stock' => 10,
            'low_stock_threshold' => 4,
            'unit' => 'fish',
            'updated_at' => $now,
        ],
        [
            'id' => 6,
            'sku' => 'WFM-002',
            'name' => 'Dry-Aged Prime Ribeye (14 oz)',
            'category' => 'Wood-Fired Mains',
            'price' => 58.00,
            'description' => '28-day dry-aged ribeye seared over glowing embers with roasted bone marrow butter and crispy fingerlings.',
            'image' => 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Gluten-Free'],
            'featured' => false,
            'available' => true,
            'stock' => 8,
            'low_stock_threshold' => 3,
            'unit' => 'cuts',
            'updated_at' => $now,
        ],
        [
            'id' => 7,
            'sku' => 'WFM-003',
            'name' => 'Hearth-Spiced Half Mary’s Chicken',
            'category' => 'Wood-Fired Mains',
            'price' => 32.00,
            'description' => 'Free-range California chicken marinated in preserved lemon, oregano, and smoked paprika with garlic jus.',
            'image' => 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Gluten-Free'],
            'featured' => false,
            'available' => true,
            'stock' => 15,
            'low_stock_threshold' => 4,
            'unit' => 'portions',
            'updated_at' => $now,
        ],
        [
            'id' => 8,
            'sku' => 'WFM-004',
            'name' => 'Charred Cauliflower & Harissa Tahini',
            'category' => 'Wood-Fired Mains',
            'price' => 27.00,
            'description' => 'Whole-roasted romanesco & heirloom cauliflower steak over saffron tahini, pomegranate, and toasted pine nuts.',
            'image' => 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Vegetarian', 'Gluten-Free'],
            'featured' => false,
            'available' => true,
            'stock' => 16,
            'low_stock_threshold' => 5,
            'unit' => 'portions',
            'updated_at' => $now,
        ],
        [
            'id' => 9,
            'sku' => 'PST-001',
            'name' => 'Saffron Tagliolini & Santa Barbara Uni',
            'category' => 'Artisanal Pasta',
            'price' => 36.00,
            'description' => 'Hand-cut saffron egg pasta folded with local sea urchin emulsion, Meyer lemon zest, and toasted pangrattato.',
            'image' => 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?auto=format&fit=crop&w=900&q=80',
            'badges' => ["Chef's Special"],
            'featured' => true,
            'available' => true,
            'stock' => 12,
            'low_stock_threshold' => 4,
            'unit' => 'portions',
            'updated_at' => $now,
        ],
        [
            'id' => 10,
            'sku' => 'PST-002',
            'name' => 'Wild Mushroom & Black Truffle Agnolotti',
            'category' => 'Artisanal Pasta',
            'price' => 31.00,
            'description' => 'Delicate pasta parcels stuffed with chanterelles and mascarpone, finished in aged parmigiano-truffle crema.',
            'image' => 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Vegetarian'],
            'featured' => false,
            'available' => true,
            'stock' => 19,
            'low_stock_threshold' => 5,
            'unit' => 'portions',
            'updated_at' => $now,
        ],
        [
            'id' => 11,
            'sku' => 'PST-003',
            'name' => 'Spicy Nduja & Coastal Prawn Rigatoni',
            'category' => 'Artisanal Pasta',
            'price' => 33.00,
            'description' => 'Bronze-die extruded rigatoni tossed with San Marzano tomatoes, Calabrian chili, sweet prawns, and basil.',
            'image' => 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=900&q=80',
            'badges' => [],
            'featured' => false,
            'available' => true,
            'stock' => 20,
            'low_stock_threshold' => 5,
            'unit' => 'portions',
            'updated_at' => $now,
        ],
        [
            'id' => 12,
            'sku' => 'DES-001',
            'name' => 'Burnt Honey & Black Mission Fig Tart',
            'category' => 'Desserts',
            'price' => 15.00,
            'description' => 'Warm almond frangipane tart glazed with coastal wildflower honey and served with cold-pressed olive oil gelato.',
            'image' => 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Vegetarian', "Chef's Special"],
            'featured' => false,
            'available' => true,
            'stock' => 14,
            'low_stock_threshold' => 4,
            'unit' => 'slices',
            'updated_at' => $now,
        ],
        [
            'id' => 13,
            'sku' => 'DES-002',
            'name' => 'Espresso Tiramisu al Cucchiaio',
            'category' => 'Desserts',
            'price' => 14.00,
            'description' => 'Savoiardi soaked in dark roast espresso and Marsala, layered with whipped mascarpone and Valrhona cocoa.',
            'image' => 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Vegetarian'],
            'featured' => false,
            'available' => true,
            'stock' => 16,
            'low_stock_threshold' => 4,
            'unit' => 'portions',
            'updated_at' => $now,
        ],
        [
            'id' => 14,
            'sku' => 'DRK-001',
            'name' => 'Smoked Rosemary Negroni',
            'category' => 'Cocktails',
            'price' => 18.00,
            'description' => 'Botanical gin, Campari, blood orange vermouth, and rosemary smoke over a hand-carved crystal block.',
            'image' => 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Gluten-Free', "Chef's Special"],
            'featured' => false,
            'available' => true,
            'stock' => 30,
            'low_stock_threshold' => 8,
            'unit' => 'cocktails',
            'updated_at' => $now,
        ],
        [
            'id' => 15,
            'sku' => 'DRK-002',
            'name' => 'Amalfi Citrus Spritz',
            'category' => 'Cocktails',
            'price' => 16.00,
            'description' => 'Bergamot liqueur, organic prosecco, crushed thyme, and sparkling Mediterranean grapefruit soda.',
            'image' => 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Vegetarian', 'Gluten-Free'],
            'featured' => false,
            'available' => true,
            'stock' => 32,
            'low_stock_threshold' => 8,
            'unit' => 'cocktails',
            'updated_at' => $now,
        ],
        [
            'id' => 16,
            'sku' => 'DRK-003',
            'name' => 'Zero-Proof Blood Orange & Fig Tonic',
            'category' => 'Cocktails',
            'price' => 12.00,
            'description' => 'Cold-pressed California blood orange, fig leaf cordial, cardamom bitters, and crisp botanical tonic.',
            'image' => 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=900&q=80',
            'badges' => ['Vegetarian', 'Gluten-Free'],
            'featured' => false,
            'available' => true,
            'stock' => 40,
            'low_stock_threshold' => 10,
            'unit' => 'drinks',
            'updated_at' => $now,
        ],
    ];
}

function aurelia_seed_orders(): array
{
    $t1 = gmdate('c', time() - 2200);
    $t2 = gmdate('c', time() - 1500);
    $t3 = gmdate('c', time() - 800);
    $t4 = gmdate('c', time() - 300);

    return [
        [
            'id' => 'AUR-1001',
            'created_at' => $t1,
            'updated_at' => $t4,
            'customer' => [
                'name'  => 'Sophia Morales',
                'phone' => '(805) 555-0134',
                'email' => 'sophia.m@example.com',
            ],
            'fulfillment_mode' => 'delivery',
            'delivery_details' => [
                'address'       => '214 Castillo St, Apt 3B, Santa Barbara',
                'instructions'  => 'Gate code #4419. Please ring bell on arrival.',
                'window'        => 'ASAP (~35 mins)',
                'courier_name'  => 'Mateo R.',
                'eta_minutes'   => 12,
            ],
            'items' => [
                ['id' => 1, 'name' => 'Charred Octopus & Smoked Chickpea', 'price' => 22.00, 'qty' => 1],
                ['id' => 9, 'name' => 'Saffron Tagliolini & Santa Barbara Uni', 'price' => 36.00, 'qty' => 1],
            ],
            'pricing' => [
                'subtotal'     => 58.00,
                'promo_code'   => 'AURELIA10',
                'discount'     => 5.80,
                'delivery_fee' => 4.50,
                'tip'          => 8.00,
                'tax'          => 4.57,
                'total'        => 69.27,
            ],
            'payment' => [
                'method'         => 'gateway_card',
                'method_label'   => 'Online Card / Gateway',
                'status'         => 'paid_online',
                'provider'       => 'stripe_ready',
                'transaction_id' => 'GW-DEMO88412A',
                'card_last4'     => '4242',
            ],
            'status' => 'out_for_delivery',
            'timeline' => [
                ['stage' => 'received',         'label' => 'Order Received',        'at' => $t1, 'note' => 'Paid online via gateway demo (•••• 4242).'],
                ['stage' => 'preparing',        'label' => 'Cooking on the Hearth', 'at' => $t2, 'note' => 'Octopus and uni tagliolini fired by Chef Elena.'],
                ['stage' => 'packing',          'label' => 'Packed for Transit',    'at' => $t3, 'note' => 'Thermal sealed; lemon oil packed separately.'],
                ['stage' => 'out_for_delivery', 'label' => 'Out for Delivery',      'at' => $t4, 'note' => 'Courier Mateo R. departed restaurant (ETA ~12 min).'],
            ],
            'staff_notes' => [
                ['at' => $t2, 'author' => 'Host Desk', 'text' => 'Confirmed gate code #4419 via SMS with Sophia.'],
            ],
        ],
        [
            'id' => 'AUR-1002',
            'created_at' => gmdate('c', time() - 600),
            'updated_at' => gmdate('c', time() - 600),
            'customer' => [
                'name'  => 'Daniel Park',
                'phone' => '(805) 555-0177',
                'email' => 'dpark@example.com',
            ],
            'fulfillment_mode' => 'pickup',
            'delivery_details' => [
                'address'       => 'Curbside Pickup — 418 State St',
                'instructions'  => 'Silver Volvo at Haley St bay — please call when ready.',
                'window'        => '7:15 PM',
                'courier_name'  => '',
                'eta_minutes'   => 18,
            ],
            'items' => [
                ['id' => 5, 'name' => 'Whole Oak-Roasted Mediterranean Branzino', 'price' => 42.00, 'qty' => 1],
                ['id' => 12, 'name' => 'Burnt Honey & Black Mission Fig Tart', 'price' => 15.00, 'qty' => 2],
            ],
            'pricing' => [
                'subtotal'     => 72.00,
                'promo_code'   => '',
                'discount'     => 0.00,
                'delivery_fee' => 0.00,
                'tip'          => 7.20,
                'tax'          => 6.30,
                'total'        => 85.50,
            ],
            'payment' => [
                'method'         => 'reach_out',
                'method_label'   => 'Pay on Confirmation (Staff Reaches Out)',
                'status'         => 'pending_contact',
                'provider'       => 'manual_reachout',
                'transaction_id' => '',
                'card_last4'     => '',
            ],
            'status' => 'received',
            'timeline' => [
                ['stage' => 'received', 'label' => 'Order Received', 'at' => gmdate('c', time() - 600), 'note' => 'Awaiting staff callback/SMS to confirm payment & pickup time.'],
            ],
            'staff_notes' => [],
        ],
    ];
}

function aurelia_seed_reservations(): array
{
    $today = gmdate('Y-m-d');
    return [
        [
            'id'         => 'RES-8410',
            'date'       => $today,
            'time'       => '19:00',
            'guests'     => 4,
            'seating'    => 'Olive Courtyard',
            'name'       => 'Elena & Julian Ward',
            'phone'      => '(805) 555-0181',
            'email'      => 'ward.family@example.com',
            'notes'      => 'Anniversary dinner, outdoor heater requested.',
            'status'     => 'Confirmed',
            'created_at' => gmdate('c', time() - 5400),
        ],
        [
            'id'         => 'RES-8415',
            'date'       => $today,
            'time'       => '20:30',
            'guests'     => 2,
            'seating'    => "Chef's Counter",
            'name'       => 'Aarav Patel',
            'phone'      => '(805) 555-0129',
            'email'      => 'aarav.p@example.com',
            'notes'      => 'Five-Course Coastal Tasting',
            'status'     => 'Confirmed',
            'created_at' => gmdate('c', time() - 3200),
        ],
    ];
}

function aurelia_seed_inventory_log(): array
{
    return [
        [
            'at'        => gmdate('c', time() - 2200),
            'item_id'   => 1,
            'item_name' => 'Charred Octopus & Smoked Chickpea',
            'delta'     => -1,
            'new_stock' => 18,
            'reason'    => 'Order Deduction',
            'reference' => 'AUR-1001',
        ],
        [
            'at'        => gmdate('c', time() - 600),
            'item_id'   => 5,
            'item_name' => 'Whole Oak-Roasted Mediterranean Branzino',
            'delta'     => -1,
            'new_stock' => 10,
            'reason'    => 'Order Deduction',
            'reference' => 'AUR-1002',
        ],
    ];
}

function aurelia_sanitize_user(array $user): array
{
    unset($user['password_hash']);
    return $user;
}

function aurelia_seed_users(): array
{
    return [
        [
            'id'            => 'USR-1001',
            'name'          => 'Sophia Morales',
            'email'         => 'sophia.m@example.com',
            'phone'         => '(805) 555-0134',
            'address'       => '214 Castillo St, Apt 3B, Santa Barbara',
            'password_hash' => password_hash('coastal2026', PASSWORD_DEFAULT),
            'created_at'    => gmdate('c', time() - 86400),
        ],
    ];
}
