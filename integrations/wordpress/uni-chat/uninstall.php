<?php
/**
 * Удаление плагина: чистим per-site опции. Таблиц и ролей плагин не создаёт.
 * На multisite uninstall выполняется для каждого подсайта отдельно (штатно).
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

foreach ( array( 'server_url', 'public_key', 'enabled', 'show', 'selected_ids', 'consent' ) as $key ) {
	delete_option( 'unichat_' . $key );
}
