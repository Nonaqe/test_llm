<?php
/**
 * Plugin Name:       Universal Chat
 * Plugin URI:        https://github.com/example/universal-chat
 * Description:       Тонкая интеграция чата Universal Chat: страница настроек, вставка widget.js через wp_footer, health check, consent (WP Consent API), шорткод [uni_chat]. Без бизнес-логики — вся она на chat-сервере (DOC-009).
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Universal Chat
 * License:           MIT
 * Text Domain:       uni-chat
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'UNICHAT_VERSION', '0.1.0' );
define( 'UNICHAT_OPTION_PREFIX', 'unichat_' );

require_once __DIR__ . '/includes/embed.php';
require_once __DIR__ . '/includes/settings.php';

/**
 * Значения опций по умолчанию. Опции per-site (get_option): на multisite
 * каждый подсайт настраивается своим ключом независимо (DOC-009 §6).
 *
 * @return array<string, mixed>
 */
function unichat_defaults() {
	return array(
		'server_url'   => '',
		'public_key'   => '',
		'enabled'      => false,
		'show'         => 'all',
		'selected_ids' => '',
		'consent'      => false,
	);
}

/**
 * Значение опции плагина с дефолтом.
 *
 * @param string $key Ключ без префикса.
 * @return mixed
 */
function unichat_opt( $key ) {
	$defaults = unichat_defaults();
	$default  = array_key_exists( $key, $defaults ) ? $defaults[ $key ] : null;
	return get_option( UNICHAT_OPTION_PREFIX . $key, $default );
}

/**
 * Запрошен ли шорткод [uni_chat] на текущей странице: он принудительно
 * включает виджет независимо от правила «где показывать» (DOC-009 §4.4).
 * wp_footer выполняется после рендера контента, поэтому did_shortcode уже видит вызов.
 *
 * @return bool
 */
function unichat_shortcode_requested() {
	return did_shortcode( 'uni_chat' ) > 0;
}

/**
 * Показывать ли виджет на текущей странице (DOC-009 §4: «где показывать»).
 *
 * @return bool
 */
function unichat_is_enabled_for_current_page() {
	if ( ! unichat_opt( 'enabled' ) ) {
		return false;
	}
	if ( unichat_shortcode_requested() ) {
		return true;
	}
	if ( unichat_opt( 'show' ) === 'selected' ) {
		if ( ! is_singular() ) {
			return false;
		}
		$ids = array_filter( array_map( 'absint', explode( ',', (string) unichat_opt( 'selected_ids' ) ) ) );
		if ( ! $ids ) {
			return false;
		}
		return in_array( (int) get_queried_object_id(), $ids, true );
	}
	return true;
}
