<?php
/**
 * Aurelia Restaurant — Backend Configuration
 */
declare(strict_types=1);

return [
    'restaurant_name' => 'Aurelia — Wood-Fired Coastal Kitchen & Bar',
    'admin_passkey'   => 'aurelia2026',
    'currency'        => 'USD',
    'currency_symbol' => '$',
    'tax_rate'        => 0.0875,
    'delivery_fee'    => 4.50,
    'promo_codes'     => [
        'AURELIA10' => 0.10,
        'WELCOME15' => 0.15,
    ],
    'data_dir'        => __DIR__ . DIRECTORY_SEPARATOR . 'data',
    'uploads_dir'     => __DIR__ . DIRECTORY_SEPARATOR . 'uploads',
];
