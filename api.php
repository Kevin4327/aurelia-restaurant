<?php
/**
 * Aurelia Restaurant — REST API Router
 */
declare(strict_types=1);

$config = require __DIR__ . DIRECTORY_SEPARATOR . 'config.php';
require_once __DIR__ . DIRECTORY_SEPARATOR . 'backend.php';

aurelia_init_store($config);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Admin-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

function json_response(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function get_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        json_response(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
    }
    return $decoded;
}

function resolve_admin_token(array $body = []): string
{
    if (!empty($_SERVER['HTTP_X_ADMIN_TOKEN'])) {
        return (string)$_SERVER['HTTP_X_ADMIN_TOKEN'];
    }
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            if (strtolower((string)$k) === 'x-admin-token') {
                return (string)$v;
            }
        }
    }
    return isset($body['token']) ? (string)$body['token'] : '';
}

function require_admin(array $config, array $body = []): void
{
    $token = resolve_admin_token($body);
    if ($token === '' || !hash_equals((string)$config['admin_passkey'], $token)) {
        json_response(401, ['success' => false, 'error' => 'Unauthorized: Invalid staff passkey.']);
    }
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string)($_GET['action'] ?? ''));

$menuPath         = aurelia_data_path($config, 'menu.json');
$ordersPath       = aurelia_data_path($config, 'orders.json');
$reservationsPath = aurelia_data_path($config, 'reservations.json');
$logPath          = aurelia_data_path($config, 'inventory_log.json');
$inquiriesPath    = aurelia_data_path($config, 'inquiries.json');
$settingsPath     = aurelia_data_path($config, 'settings.json');

// ---------------------------------------------------------------------------
// GET ENDPOINTS
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    switch ($action) {
        case 'ping':
            json_response(200, ['success' => true, 'php' => PHP_VERSION, 'time' => gmdate('c')]);

        case 'menu':
            $menu = aurelia_read_json($menuPath, []);
            $settings = aurelia_public_settings(aurelia_read_json($settingsPath, []));
            json_response(200, [
                'success'  => true,
                'items'    => $menu,
                'settings' => $settings,
            ]);

        case 'track':
            $orderId = strtoupper(trim((string)($_GET['id'] ?? '')));
            if ($orderId === '') {
                json_response(400, ['success' => false, 'error' => 'Order ID is required.']);
            }
            $orders = aurelia_read_json($ordersPath, []);
            $found = null;
            foreach ($orders as $ord) {
                if (strtoupper((string)($ord['id'] ?? '')) === $orderId) {
                    $found = $ord;
                    break;
                }
            }
            if ($found === null) {
                json_response(404, ['success' => false, 'error' => "Order {$orderId} was not found."]);
            }
            $mode = (string)($found['fulfillment_mode'] ?? 'delivery');
            json_response(200, [
                'success' => true,
                'order'   => $found,
                'stages'  => aurelia_roadmap_stages($mode),
            ]);

        case 'reservation_lookup':
            $rawIds = trim((string)($_GET['ids'] ?? ''));
            if ($rawIds === '') {
                json_response(200, ['success' => true, 'reservations' => []]);
            }
            $wanted = array_filter(array_map('strtoupper', array_map('trim', explode(',', $rawIds))));
            $reservations = aurelia_read_json($reservationsPath, []);
            $matched = array_values(array_filter($reservations, static function ($r) use ($wanted) {
                return in_array(strtoupper((string)($r['id'] ?? '')), $wanted, true);
            }));
            json_response(200, ['success' => true, 'reservations' => $matched]);

        case 'admin_bootstrap':
            require_admin($config);
            $menu         = aurelia_read_json($menuPath, []);
            $orders       = aurelia_read_json($ordersPath, []);
            $reservations = aurelia_read_json($reservationsPath, []);
            $logs         = aurelia_read_json($logPath, []);
            $inquiries    = aurelia_read_json($inquiriesPath, []);
            $settings     = aurelia_public_settings(aurelia_read_json($settingsPath, []));

            $grossRevenue = 0.0;
            $paidRevenue = 0.0;
            $pendingRevenue = 0.0;
            $activeOrders = 0;

            foreach ($orders as $ord) {
                $status = (string)($ord['status'] ?? '');
                $total  = (float)($ord['pricing']['total'] ?? 0);
                $payStatus = (string)($ord['payment']['status'] ?? 'pending_contact');

                if ($status !== 'cancelled') {
                    $grossRevenue += $total;
                    if (in_array($payStatus, ['paid_online', 'paid_in_person'], true)) {
                        $paidRevenue += $total;
                    } elseif ($payStatus !== 'refunded') {
                        $pendingRevenue += $total;
                    }
                    if ($status !== 'delivered') {
                        $activeOrders++;
                    }
                }
            }

            $lowStockCount = 0;
            $outOfStockCount = 0;
            foreach ($menu as $item) {
                $stock = (int)($item['stock'] ?? 0);
                $thresh = (int)($item['low_stock_threshold'] ?? 5);
                if ($stock <= 0 || empty($item['available'])) {
                    $outOfStockCount++;
                } elseif ($stock <= $thresh) {
                    $lowStockCount++;
                }
            }

            json_response(200, [
                'success'      => true,
                'menu'         => $menu,
                'orders'       => $orders,
                'reservations' => $reservations,
                'inventory_log'=> $logs,
                'inquiries'    => $inquiries,
                'settings'     => $settings,
                'roadmap_meta' => [
                    'delivery' => aurelia_roadmap_stages('delivery'),
                    'pickup'   => aurelia_roadmap_stages('pickup'),
                ],
                'metrics'      => [
                    'gross_revenue'      => round($grossRevenue, 2),
                    'paid_revenue'       => round($paidRevenue, 2),
                    'pending_revenue'    => round($pendingRevenue, 2),
                    'active_orders'      => $activeOrders,
                    'total_orders'       => count($orders),
                    'low_stock_count'    => $lowStockCount,
                    'out_of_stock_count' => $outOfStockCount,
                    'reservations_count' => count($reservations),
                ],
            ]);

        default:
            json_response(400, ['success' => false, 'error' => 'Unknown GET action.']);
    }
}

// ---------------------------------------------------------------------------
// POST ENDPOINTS
// ---------------------------------------------------------------------------
if ($method === 'POST') {
    // Handle multipart upload separately before reading php://input JSON
    if ($action === 'upload_image') {
        require_admin($config);
        if (empty($_FILES['image']) || !is_array($_FILES['image'])) {
            json_response(400, ['success' => false, 'error' => 'No image file provided.']);
        }
        $file = $_FILES['image'];
        if ((int)$file['error'] !== UPLOAD_ERR_OK) {
            json_response(400, ['success' => false, 'error' => 'Upload failed with code ' . $file['error']]);
        }
        if ((int)$file['size'] > 5 * 1024 * 1024) {
            json_response(400, ['success' => false, 'error' => 'Image must be 5 MB or smaller.']);
        }
        $ext = strtolower(pathinfo((string)$file['name'], PATHINFO_EXTENSION));
        $allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
        if (!in_array($ext, $allowed, true)) {
            json_response(400, ['success' => false, 'error' => 'Allowed formats: JPG, PNG, WEBP, GIF.']);
        }
        if (@getimagesize($file['tmp_name']) === false) {
            json_response(400, ['success' => false, 'error' => 'Uploaded file is not a valid image.']);
        }

        $safeName = 'dish-' . date('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.' . $ext;
        $destPath = $config['uploads_dir'] . DIRECTORY_SEPARATOR . $safeName;
        if (!move_uploaded_file($file['tmp_name'], $destPath)) {
            json_response(500, ['success' => false, 'error' => 'Failed to store uploaded image.']);
        }
        json_response(200, [
            'success' => true,
            'url'     => 'uploads/' . $safeName,
        ]);
    }

    $body = get_json_body();

    switch ($action) {
        case 'admin_login':
            $passkey = (string)($body['passkey'] ?? '');
            if (!hash_equals((string)$config['admin_passkey'], $passkey)) {
                json_response(401, ['success' => false, 'error' => 'Invalid passkey. Try aurelia2026 for demo access.']);
            }
            json_response(200, ['success' => true, 'token' => $config['admin_passkey']]);

        case 'order_create':
            $settings = aurelia_read_json($settingsPath, []);
            if (isset($settings['accepting_orders']) && !$settings['accepting_orders']) {
                json_response(503, ['success' => false, 'error' => 'Online ordering is temporarily paused by the kitchen.']);
            }

            $customer = $body['customer'] ?? [];
            $name  = trim((string)($customer['name'] ?? ''));
            $phone = trim((string)($customer['phone'] ?? ''));
            $email = trim((string)($customer['email'] ?? ''));

            if ($name === '' || $phone === '') {
                json_response(400, ['success' => false, 'error' => 'Customer name and phone number are required so our team can reach out.']);
            }

            $mode = ($body['fulfillment_mode'] ?? 'pickup') === 'delivery' ? 'delivery' : 'pickup';
            $address = trim((string)($body['delivery']['address'] ?? ''));
            $instructions = trim((string)($body['delivery']['instructions'] ?? ''));
            $window = trim((string)($body['delivery']['window'] ?? ($mode === 'delivery' ? 'ASAP (~35 mins)' : 'ASAP (~20 mins)')));

            if ($mode === 'delivery' && $address === '') {
                json_response(400, ['success' => false, 'error' => 'Delivery street address is required for local delivery.']);
            }

            $reqItems = $body['items'] ?? [];
            if (!is_array($reqItems) || count($reqItems) === 0) {
                json_response(400, ['success' => false, 'error' => 'Your cart is empty.']);
            }

            $menu = aurelia_read_json($menuPath, []);
            $menuById = [];
            foreach ($menu as $idx => $item) {
                $menuById[(int)$item['id']] = $idx;
            }

            $orderItems = [];
            $subtotal = 0.0;
            $inventoryDeductions = [];

            foreach ($reqItems as $req) {
                $id  = (int)($req['id'] ?? 0);
                $qty = max(1, (int)($req['qty'] ?? 0));
                if (!isset($menuById[$id])) {
                    json_response(400, ['success' => false, 'error' => "Menu item #{$id} no longer exists."]);
                }
                $idx = $menuById[$id];
                $dish = $menu[$idx];

                if (empty($dish['available']) || (int)$dish['stock'] <= 0) {
                    json_response(409, ['success' => false, 'error' => "{$dish['name']} is currently sold out."]);
                }
                if ((int)$dish['stock'] < $qty) {
                    json_response(409, [
                        'success' => false,
                        'error'   => "Only {$dish['stock']} {$dish['unit']} left of {$dish['name']}.",
                    ]);
                }

                $unitPrice = (float)$dish['price'];
                $subtotal += $unitPrice * $qty;
                $orderItems[] = [
                    'id'    => $id,
                    'sku'   => (string)($dish['sku'] ?? ''),
                    'name'  => (string)$dish['name'],
                    'price' => round($unitPrice, 2),
                    'qty'   => $qty,
                ];

                $menu[$idx]['stock'] = (int)$dish['stock'] - $qty;
                if ($menu[$idx]['stock'] <= 0) {
                    $menu[$idx]['stock'] = 0;
                    $menu[$idx]['available'] = false;
                }
                $menu[$idx]['updated_at'] = gmdate('c');

                $inventoryDeductions[] = [
                    'item_id'   => $id,
                    'item_name' => (string)$dish['name'],
                    'delta'     => -$qty,
                    'new_stock' => $menu[$idx]['stock'],
                ];
            }

            $promoCode = strtoupper(trim((string)($body['promo_code'] ?? '')));
            $discountRate = $config['promo_codes'][$promoCode] ?? 0.0;
            $discount = round($subtotal * $discountRate, 2);
            if ($discountRate <= 0) {
                $promoCode = '';
            }

            $deliveryFee = $mode === 'delivery' ? (float)($settings['delivery_fee'] ?? $config['delivery_fee']) : 0.0;
            $taxRate     = (float)($settings['tax_rate'] ?? $config['tax_rate']);
            $tip         = max(0.0, round((float)($body['tip'] ?? 0.0), 2));
            $tax         = round(max(0.0, $subtotal - $discount) * $taxRate, 2);
            $total       = round(max(0.0, $subtotal - $discount) + $deliveryFee + $tax + $tip, 2);

            $paymentMethod = (string)($body['payment_method'] ?? 'reach_out');
            $paymentRecord = [
                'method'         => $paymentMethod,
                'method_label'   => 'Pay on Confirmation (Staff Reaches Out)',
                'status'         => 'pending_contact',
                'provider'       => 'manual_reachout',
                'transaction_id' => '',
                'card_last4'     => '',
            ];

            if ($paymentMethod === 'pay_on_arrival') {
                $paymentRecord['method_label'] = $mode === 'delivery' ? 'Cash or Card on Delivery' : 'Cash or Card at Pickup';
                $paymentRecord['status'] = 'pay_on_arrival';
                $paymentRecord['provider'] = 'in_person';
            } elseif ($paymentMethod === 'gateway_card') {
                $gwResult = aurelia_process_gateway_payment($settings, $total, $body['gateway_payload'] ?? []);
                if (!$gwResult['ok']) {
                    json_response(400, ['success' => false, 'error' => $gwResult['error']]);
                }
                $paymentRecord['method_label']   = (string)($settings['payment_gateway']['label'] ?? 'Online Card / Gateway');
                $paymentRecord['status']         = $gwResult['payment_status'];
                $paymentRecord['provider']       = $gwResult['provider'];
                $paymentRecord['transaction_id'] = $gwResult['transaction_id'];
                $paymentRecord['card_last4']     = $gwResult['card_last4'];
            }

            $orders = aurelia_read_json($ordersPath, []);
            $maxSeq = 1000;
            foreach ($orders as $existing) {
                if (preg_match('/AUR-(\d+)/', (string)($existing['id'] ?? ''), $m)) {
                    $maxSeq = max($maxSeq, (int)$m[1]);
                }
            }
            $orderId = 'AUR-' . ($maxSeq + 1);
            $now = gmdate('c');
            $etaMin = $mode === 'delivery'
                ? (int)($settings['delivery_eta_min'] ?? 35)
                : (int)($settings['prep_time_min'] ?? 20);

            $initialNote = match ($paymentRecord['status']) {
                'paid_online'    => "Paid online via {$paymentRecord['provider']} (•••• {$paymentRecord['card_last4']}).",
                'pay_on_arrival' => 'Confirmed for payment upon handoff.',
                default          => 'Order placed — restaurant team will reach out shortly to confirm details & payment.',
            };

            $newOrder = [
                'id'               => $orderId,
                'created_at'       => $now,
                'updated_at'       => $now,
                'customer'         => [
                    'name'  => $name,
                    'phone' => $phone,
                    'email' => $email,
                ],
                'fulfillment_mode' => $mode,
                'delivery_details' => [
                    'address'      => $mode === 'delivery' ? $address : 'Curbside Pickup — 418 State St',
                    'instructions' => $instructions,
                    'window'       => $window,
                    'courier_name' => '',
                    'eta_minutes'  => $etaMin,
                ],
                'items'            => $orderItems,
                'pricing'          => [
                    'subtotal'     => round($subtotal, 2),
                    'promo_code'   => $promoCode,
                    'discount'     => $discount,
                    'delivery_fee' => round($deliveryFee, 2),
                    'tip'          => $tip,
                    'tax'          => $tax,
                    'total'        => $total,
                ],
                'payment'          => $paymentRecord,
                'status'           => 'received',
                'timeline'         => [
                    [
                        'stage' => 'received',
                        'label' => 'Order Received',
                        'at'    => $now,
                        'note'  => $initialNote,
                    ],
                ],
                'staff_notes'      => [],
            ];

            array_unshift($orders, $newOrder);
            aurelia_write_json($menuPath, $menu);
            aurelia_write_json($ordersPath, $orders);

            foreach ($inventoryDeductions as $ded) {
                aurelia_append_inventory_log($config, [
                    'at'        => $now,
                    'item_id'   => $ded['item_id'],
                    'item_name' => $ded['item_name'],
                    'delta'     => $ded['delta'],
                    'new_stock' => $ded['new_stock'],
                    'reason'    => 'Order Deduction',
                    'reference' => $orderId,
                ]);
            }

            json_response(201, [
                'success' => true,
                'order'   => $newOrder,
                'stages'  => aurelia_roadmap_stages($mode),
            ]);

        case 'order_customer_note':
            $orderId = strtoupper(trim((string)($body['order_id'] ?? '')));
            $note    = trim((string)($body['note'] ?? ''));
            if ($orderId === '' || $note === '') {
                json_response(400, ['success' => false, 'error' => 'Order ID and message are required.']);
            }
            $orders = aurelia_read_json($ordersPath, []);
            $updated = null;
            foreach ($orders as $idx => $ord) {
                if (strtoupper((string)($ord['id'] ?? '')) === $orderId) {
                    $entry = [
                        'at'     => gmdate('c'),
                        'author' => 'Customer',
                        'text'   => $note,
                    ];
                    $orders[$idx]['staff_notes'][] = $entry;
                    $orders[$idx]['updated_at'] = gmdate('c');
                    $updated = $orders[$idx];
                    break;
                }
            }
            if ($updated === null) {
                json_response(404, ['success' => false, 'error' => 'Order not found.']);
            }
            aurelia_write_json($ordersPath, $orders);
            json_response(200, ['success' => true, 'order' => $updated]);

        case 'order_update':
            require_admin($config, $body);
            $orderId = strtoupper(trim((string)($body['order_id'] ?? '')));
            if ($orderId === '') {
                json_response(400, ['success' => false, 'error' => 'Order ID is required.']);
            }
            $orders = aurelia_read_json($ordersPath, []);
            $foundIdx = null;
            foreach ($orders as $idx => $ord) {
                if (strtoupper((string)($ord['id'] ?? '')) === $orderId) {
                    $foundIdx = $idx;
                    break;
                }
            }
            if ($foundIdx === null) {
                json_response(404, ['success' => false, 'error' => 'Order not found.']);
            }

            $order = $orders[$foundIdx];
            $prevStatus = (string)($order['status'] ?? 'received');
            $now = gmdate('c');

            if (isset($body['courier_name'])) {
                $order['delivery_details']['courier_name'] = trim((string)$body['courier_name']);
            }
            if (isset($body['eta_minutes']) && $body['eta_minutes'] !== '') {
                $order['delivery_details']['eta_minutes'] = max(0, (int)$body['eta_minutes']);
            }
            if (!empty($body['payment_status'])) {
                $order['payment']['status'] = trim((string)$body['payment_status']);
            }
            if (!empty($body['reach_out_note'])) {
                $order['staff_notes'][] = [
                    'at'     => $now,
                    'author' => 'Staff Outreach',
                    'text'   => trim((string)$body['reach_out_note']),
                ];
            }

            $newStatus = isset($body['status']) ? trim((string)$body['status']) : $prevStatus;
            $stageNote = trim((string)($body['stage_note'] ?? ''));

            if ($newStatus !== $prevStatus || $stageNote !== '') {
                $mode = (string)($order['fulfillment_mode'] ?? 'delivery');
                $stages = aurelia_roadmap_stages($mode);
                $labelMap = ['cancelled' => 'Order Cancelled'];
                foreach ($stages as $s) {
                    $labelMap[$s['key']] = $s['label'];
                }

                // Restore stock if cancelling an active order
                if ($newStatus === 'cancelled' && $prevStatus !== 'cancelled') {
                    $menu = aurelia_read_json($menuPath, []);
                    $menuMap = [];
                    foreach ($menu as $mIdx => $mItem) {
                        $menuMap[(int)$mItem['id']] = $mIdx;
                    }
                    foreach ($order['items'] as $oItem) {
                        $mId = (int)$oItem['id'];
                        if (isset($menuMap[$mId])) {
                            $mIdx = $menuMap[$mId];
                            $qty = (int)$oItem['qty'];
                            $menu[$mIdx]['stock'] = (int)$menu[$mIdx]['stock'] + $qty;
                            if ($menu[$mIdx]['stock'] > 0) {
                                $menu[$mIdx]['available'] = true;
                            }
                            $menu[$mIdx]['updated_at'] = $now;
                            aurelia_append_inventory_log($config, [
                                'at'        => $now,
                                'item_id'   => $mId,
                                'item_name' => (string)$menu[$mIdx]['name'],
                                'delta'     => $qty,
                                'new_stock' => $menu[$mIdx]['stock'],
                                'reason'    => 'Order Cancelled Restock',
                                'reference' => $orderId,
                            ]);
                        }
                    }
                    aurelia_write_json($menuPath, $menu);
                }

                $order['status'] = $newStatus;
                $order['timeline'][] = [
                    'stage' => $newStatus,
                    'label' => $labelMap[$newStatus] ?? ucfirst(str_replace('_', ' ', $newStatus)),
                    'at'    => $now,
                    'note'  => $stageNote !== '' ? $stageNote : 'Status updated by Aurelia kitchen team.',
                ];
            }

            $order['updated_at'] = $now;
            $orders[$foundIdx] = $order;
            aurelia_write_json($ordersPath, $orders);

            json_response(200, ['success' => true, 'order' => $order]);

        case 'menu_save':
            require_admin($config, $body);
            $menu = aurelia_read_json($menuPath, []);
            $itemData = $body['item'] ?? $body;

            $name = trim((string)($itemData['name'] ?? ''));
            $category = trim((string)($itemData['category'] ?? 'Starters'));
            $price = round((float)($itemData['price'] ?? 0), 2);
            if ($name === '' || $price <= 0) {
                json_response(400, ['success' => false, 'error' => 'Dish name and a valid positive price are required.']);
            }

            $id = (int)($itemData['id'] ?? 0);
            $now = gmdate('c');
            $badges = $itemData['badges'] ?? [];
            if (is_string($badges)) {
                $badges = array_values(array_filter(array_map('trim', explode(',', $badges))));
            }

            $stock = max(0, (int)($itemData['stock'] ?? 15));
            $available = isset($itemData['available']) ? (bool)$itemData['available'] : ($stock > 0);
            if ($stock === 0) {
                $available = false;
            }

            $payload = [
                'id'                  => $id,
                'sku'                 => trim((string)($itemData['sku'] ?? 'AUR-' . rand(100, 999))),
                'name'                => $name,
                'category'            => $category,
                'price'               => $price,
                'description'         => trim((string)($itemData['description'] ?? '')),
                'image'               => trim((string)($itemData['image'] ?? 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80')),
                'badges'              => array_values($badges),
                'featured'            => !empty($itemData['featured']),
                'available'           => $available,
                'stock'               => $stock,
                'low_stock_threshold' => max(1, (int)($itemData['low_stock_threshold'] ?? 5)),
                'unit'                => trim((string)($itemData['unit'] ?? 'portions')) ?: 'portions',
                'updated_at'          => $now,
            ];

            $updated = false;
            if ($id > 0) {
                foreach ($menu as $idx => $existing) {
                    if ((int)$existing['id'] === $id) {
                        $prevStock = (int)($existing['stock'] ?? 0);
                        $menu[$idx] = $payload;
                        $updated = true;
                        if ($prevStock !== $stock) {
                            aurelia_append_inventory_log($config, [
                                'at'        => $now,
                                'item_id'   => $id,
                                'item_name' => $name,
                                'delta'     => $stock - $prevStock,
                                'new_stock' => $stock,
                                'reason'    => 'Menu CMS Edit',
                                'reference' => 'ADMIN',
                            ]);
                        }
                        break;
                    }
                }
            }

            if (!$updated) {
                $maxId = 0;
                foreach ($menu as $m) {
                    $maxId = max($maxId, (int)$m['id']);
                }
                $payload['id'] = $maxId + 1;
                array_unshift($menu, $payload);
                aurelia_append_inventory_log($config, [
                    'at'        => $now,
                    'item_id'   => $payload['id'],
                    'item_name' => $name,
                    'delta'     => $stock,
                    'new_stock' => $stock,
                    'reason'    => 'New Dish Added',
                    'reference' => 'ADMIN',
                ]);
            }

            aurelia_write_json($menuPath, $menu);
            json_response(200, ['success' => true, 'item' => $payload, 'menu' => $menu]);

        case 'menu_delete':
            require_admin($config, $body);
            $id = (int)($body['id'] ?? 0);
            $menu = aurelia_read_json($menuPath, []);
            $filtered = array_values(array_filter($menu, static fn($m) => (int)$m['id'] !== $id));
            aurelia_write_json($menuPath, $filtered);
            json_response(200, ['success' => true, 'menu' => $filtered]);

        case 'inventory_adjust':
            require_admin($config, $body);
            $id = (int)($body['id'] ?? 0);
            $menu = aurelia_read_json($menuPath, []);
            $foundIdx = null;
            foreach ($menu as $idx => $m) {
                if ((int)$m['id'] === $id) {
                    $foundIdx = $idx;
                    break;
                }
            }
            if ($foundIdx === null) {
                json_response(404, ['success' => false, 'error' => 'Dish not found.']);
            }

            $prevStock = (int)$menu[$foundIdx]['stock'];
            if (isset($body['set_stock'])) {
                $newStock = max(0, (int)$body['set_stock']);
            } else {
                $delta = (int)($body['delta'] ?? 0);
                $newStock = max(0, $prevStock + $delta);
            }

            $menu[$foundIdx]['stock'] = $newStock;
            if (isset($body['available'])) {
                $menu[$foundIdx]['available'] = (bool)$body['available'];
            } elseif ($newStock > 0 && $prevStock === 0) {
                $menu[$foundIdx]['available'] = true;
            } elseif ($newStock === 0) {
                $menu[$foundIdx]['available'] = false;
            }
            if (isset($body['low_stock_threshold'])) {
                $menu[$foundIdx]['low_stock_threshold'] = max(1, (int)$body['low_stock_threshold']);
            }
            $now = gmdate('c');
            $menu[$foundIdx]['updated_at'] = $now;

            aurelia_write_json($menuPath, $menu);
            aurelia_append_inventory_log($config, [
                'at'        => $now,
                'item_id'   => $id,
                'item_name' => (string)$menu[$foundIdx]['name'],
                'delta'     => $newStock - $prevStock,
                'new_stock' => $newStock,
                'reason'    => trim((string)($body['reason'] ?? 'Manual Adjustment')) ?: 'Manual Adjustment',
                'reference' => 'INV-CTRL',
            ]);

            json_response(200, ['success' => true, 'item' => $menu[$foundIdx], 'menu' => $menu]);

        case 'reservation_create':
            $date    = trim((string)($body['date'] ?? ''));
            $time    = trim((string)($body['time'] ?? ''));
            $guests  = max(1, (int)($body['guests'] ?? 2));
            $seating = trim((string)($body['seating'] ?? 'Main Dining Room'));
            $name    = trim((string)($body['name'] ?? ''));
            $phone   = trim((string)($body['phone'] ?? ''));
            $email   = trim((string)($body['email'] ?? ''));
            $notes   = trim((string)($body['notes'] ?? ''));

            if ($date === '' || $time === '' || $name === '' || $phone === '' || $email === '') {
                json_response(400, ['success' => false, 'error' => 'Please complete date, time, name, phone, and email.']);
            }

            $reservations = aurelia_read_json($reservationsPath, []);
            $newRes = [
                'id'         => 'RES-' . rand(1000, 9999),
                'date'       => $date,
                'time'       => $time,
                'guests'     => $guests,
                'seating'    => $seating,
                'name'       => $name,
                'phone'      => $phone,
                'email'      => $email,
                'notes'      => $notes,
                'status'     => 'Confirmed',
                'created_at' => gmdate('c'),
            ];
            array_unshift($reservations, $newRes);
            aurelia_write_json($reservationsPath, $reservations);

            json_response(201, ['success' => true, 'reservation' => $newRes]);

        case 'reservation_update':
            require_admin($config, $body);
            $resId  = trim((string)($body['id'] ?? ''));
            $status = trim((string)($body['status'] ?? 'Confirmed'));
            $reservations = aurelia_read_json($reservationsPath, []);
            $updated = null;
            foreach ($reservations as $idx => $r) {
                if ((string)($r['id'] ?? '') === $resId) {
                    $reservations[$idx]['status'] = $status;
                    $updated = $reservations[$idx];
                    break;
                }
            }
            if ($updated === null) {
                json_response(404, ['success' => false, 'error' => 'Reservation not found.']);
            }
            aurelia_write_json($reservationsPath, $reservations);
            json_response(200, ['success' => true, 'reservation' => $updated]);

        case 'inquiry_create':
            $name    = trim((string)($body['name'] ?? ''));
            $email   = trim((string)($body['email'] ?? ''));
            $phone   = trim((string)($body['phone'] ?? ''));
            $topic   = trim((string)($body['topic'] ?? 'Private Dining'));
            $message = trim((string)($body['message'] ?? ''));
            if ($name === '' || ($email === '' && $phone === '') || $message === '') {
                json_response(400, ['success' => false, 'error' => 'Name, contact method, and message are required.']);
            }
            $inquiries = aurelia_read_json($inquiriesPath, []);
            $entry = [
                'id'         => 'INQ-' . rand(1000, 9999),
                'name'       => $name,
                'email'      => $email,
                'phone'      => $phone,
                'topic'      => $topic,
                'message'    => $message,
                'created_at' => gmdate('c'),
            ];
            array_unshift($inquiries, $entry);
            aurelia_write_json($inquiriesPath, $inquiries);
            json_response(201, ['success' => true, 'inquiry' => $entry]);

        case 'settings_save':
            require_admin($config, $body);
            $current = aurelia_read_json($settingsPath, aurelia_seed_settings($config));
            $incoming = $body['settings'] ?? $body;

            if (isset($incoming['accepting_orders'])) {
                $current['accepting_orders'] = (bool)$incoming['accepting_orders'];
            }
            if (isset($incoming['prep_time_min'])) {
                $current['prep_time_min'] = max(5, (int)$incoming['prep_time_min']);
            }
            if (isset($incoming['delivery_eta_min'])) {
                $current['delivery_eta_min'] = max(10, (int)$incoming['delivery_eta_min']);
            }
            if (isset($incoming['delivery_fee'])) {
                $current['delivery_fee'] = max(0, round((float)$incoming['delivery_fee'], 2));
            }
            if (isset($incoming['payment_gateway']) && is_array($incoming['payment_gateway'])) {
                $gw = $incoming['payment_gateway'];
                $current['payment_gateway']['enabled']       = isset($gw['enabled']) ? (bool)$gw['enabled'] : $current['payment_gateway']['enabled'];
                $current['payment_gateway']['provider']      = trim((string)($gw['provider'] ?? $current['payment_gateway']['provider']));
                $current['payment_gateway']['mode']          = trim((string)($gw['mode'] ?? $current['payment_gateway']['mode']));
                $current['payment_gateway']['label']         = trim((string)($gw['label'] ?? $current['payment_gateway']['label']));
                $current['payment_gateway']['public_key']    = trim((string)($gw['public_key'] ?? $current['payment_gateway']['public_key']));
                $current['payment_gateway']['webhook_url']   = trim((string)($gw['webhook_url'] ?? $current['payment_gateway']['webhook_url']));
                $current['payment_gateway']['checkout_note'] = trim((string)($gw['checkout_note'] ?? $current['payment_gateway']['checkout_note']));
            }

            aurelia_write_json($settingsPath, $current);
            json_response(200, ['success' => true, 'settings' => aurelia_public_settings($current)]);

        default:
            json_response(400, ['success' => false, 'error' => 'Unknown POST action.']);
    }
}

json_response(405, ['success' => false, 'error' => 'Method not allowed.']);
