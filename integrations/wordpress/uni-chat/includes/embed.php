<?php
/**
 * Вставка виджета: wp_footer + consent (WP Consent API) + шорткод [uni_chat].
 * Тот же скрипт и механизм, что на чистом сайте — единый Integration Contract
 * (DOC-009 §4.2, DOC-010). Никакой логики чата здесь нет.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'init', 'unichat_register_shortcode' );

/**
 * Шорткод [uni_chat]: маркер-контейнер; сам факт его вызова форсирует вставку
 * виджета на этой странице (см. unichat_shortcode_requested).
 *
 * @param array<string, mixed>|string $atts    Атрибуты (зарезервировано).
 * @param string                      $content Обёртка (не используется).
 * @return string
 */
function unichat_register_shortcode() {
	add_shortcode(
		'uni_chat',
		static function ( $atts = array(), $content = '' ) {
			unset( $atts, $content );
			return '<div class="uni-chat-embed" data-uni-chat="1"></div>';
		}
	);
}

add_action( 'wp_footer', 'unichat_print_widget_script' );

/**
 * Печать <script> виджета в футере с учётом «где показывать» и consent.
 *
 * @return void
 */
function unichat_print_widget_script() {
	if ( ! function_exists( 'unichat_is_enabled_for_current_page' ) || ! unichat_is_enabled_for_current_page() ) {
		return;
	}

	$server = trim( (string) unichat_opt( 'server_url' ) );
	$key    = trim( (string) unichat_opt( 'public_key' ) );
	if ( '' === $server || '' === $key ) {
		return;
	}

	$script = sprintf(
		'<script id="uni-chat-widget-script" src="%s/widget.js" data-chat-key="%s" defer></script>',
		esc_url( $server ),
		esc_attr( $key )
	);

	// Consent-режим (DOC-009 §4.3): без согласия скрипт не грузится вовсе.
	// Если WP Consent API активен и согласия ещё нет — ждём события согласия.
	if ( unichat_opt( 'consent' ) ) {
		$has_api  = function_exists( 'wp_has_consent' );
		$granted  = $has_api && wp_has_consent( 'functional' );
		if ( ! $granted ) {
			printf(
				'<script>(function(){var s=%1$s;' .
				'function ins(){if(document.getElementById("uni-chat-widget-script"))return;' .
				'document.body.insertAdjacentHTML("beforeend",s);}' .
				'if(window.wp_has_consent&&window.wp_has_consent("functional")){ins();return;}' .
				'document.addEventListener("wp_listen_for_consent_change",function(e){' .
				'if(e.detail&&(e.detail.functional==="allow")){ins();}});})();</script>',
				wp_json_encode( $script )
			);
			return;
		}
	}

	echo $script; // phpcs:ignore WordPress.Security.EscapeOutput -- собран из esc_url/esc_attr выше.
}
