<?php
/**
 * Страница настроек «Universal Chat» (нативный WP UI, Settings API).
 * Capability: manage_options. Секретов нет — только publishable key (DOC-009 §4).
 * Единственный исходящий вызов — health check на настроенный сервер (§7).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'admin_menu', 'unichat_admin_menu' );

/**
 * Регистрация меню верхнего уровня «Universal Chat».
 *
 * @return void
 */
function unichat_admin_menu() {
	add_menu_page(
		'Universal Chat',
		'Universal Chat',
		'manage_options',
		'unichat',
		'unichat_render_settings_page',
		'dashicons-format-chat',
		58
	);
}

add_action( 'admin_init', 'unichat_register_settings' );

/**
 * Регистрация опций с санитайзерами; nonce/capability проверяет сам options.php.
 *
 * @return void
 */
function unichat_register_settings() {
	register_setting(
		'unichat',
		UNICHAT_OPTION_PREFIX . 'server_url',
		array(
			'type'              => 'string',
			'sanitize_callback' => static function ( $v ) {
				return esc_url_raw( trim( (string) $v ) );
			},
			'default'           => '',
		)
	);

	register_setting(
		'unichat',
		UNICHAT_OPTION_PREFIX . 'public_key',
		array(
			'type'              => 'string',
			'sanitize_callback' => static function ( $v ) {
				$key = sanitize_text_field( trim( (string) $v ) );
				// Publishable key формата pk_*; ничего не обрезаем молча.
				return $key;
			},
			'default'           => '',
		)
	);

	register_setting(
		'unichat',
		UNICHAT_OPTION_PREFIX . 'enabled',
		array(
			'type'              => 'boolean',
			'sanitize_callback' => static function ( $v ) {
				return (bool) $v;
			},
			'default'           => false,
		)
	);

	register_setting(
		'unichat',
		UNICHAT_OPTION_PREFIX . 'show',
		array(
			'type'              => 'string',
			'sanitize_callback' => static function ( $v ) {
				return in_array( (string) $v, array( 'all', 'selected' ), true ) ? (string) $v : 'all';
			},
			'default'           => 'all',
		)
	);

	register_setting(
		'unichat',
		UNICHAT_OPTION_PREFIX . 'selected_ids',
		array(
			'type'              => 'string',
			'sanitize_callback' => static function ( $v ) {
				$ids = array_filter( array_map( 'absint', explode( ',', (string) $v ) ) );
				return implode( ',', $ids );
			},
			'default'           => '',
		)
	);

	register_setting(
		'unichat',
		UNICHAT_OPTION_PREFIX . 'consent',
		array(
			'type'              => 'boolean',
			'sanitize_callback' => static function ( $v ) {
				return (bool) $v;
			},
			'default'           => false,
		)
	);
}

add_action( 'admin_enqueue_scripts', 'unichat_admin_assets' );

/**
 * Стили и скрипт health check только на странице настроек плагина.
 *
 * @param string $hook Текущий экран админки.
 * @return void
 */
function unichat_admin_assets( $hook ) {
	if ( 'toplevel_page_unichat' !== $hook ) {
		return;
	}
	wp_enqueue_style( 'unichat-admin', plugins_url( 'assets/admin.css', dirname( __DIR__ ) . '/uni-chat.php' ), array(), UNICHAT_VERSION );
}

add_action( 'wp_ajax_unichat_health', 'unichat_ajax_health' );

/**
 * AJAX health check: GET {server}/widget/v1/health (wp_remote_get — без CORS).
 * Ответ сервера в конверте {data:{status,version}} — учитываем оба варианта.
 *
 * @return void
 */
function unichat_ajax_health() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_send_json_error( array( 'message' => 'Недостаточно прав' ), 403 );
	}
	check_ajax_referer( 'unichat_health', 'nonce' );

	$server = trim( (string) unichat_opt( 'server_url' ) );
	if ( '' === $server ) {
		wp_send_json_error( array( 'message' => 'Сначала укажите Chat Server URL' ) );
	}

	$url = esc_url_raw( trailingslashit( $server ) . 'widget/v1/health' );
	$res = wp_remote_get( $url, array( 'timeout' => 8 ) );

	if ( is_wp_error( $res ) ) {
		wp_send_json_error( array( 'message' => $res->get_error_message() ) );
	}

	$code = (int) wp_remote_retrieve_response_code( $res );
	$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	$data = ( isset( $body['data'] ) && is_array( $body['data'] ) ) ? $body['data'] : $body;

	if ( 200 === $code && isset( $data['status'] ) && 'ok' === $data['status'] ) {
		wp_send_json_success(
			array(
				'version' => isset( $data['version'] ) ? (string) $data['version'] : '',
			)
		);
	}

	wp_send_json_error( array( 'message' => sprintf( 'Сервер ответил HTTP %d', $code ) ) );
}

/**
 * Разметка страницы настроек.
 *
 * @return void
 */
function unichat_render_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$server      = (string) unichat_opt( 'server_url' );
	$key         = (string) unichat_opt( 'public_key' );
	$enabled     = (bool) unichat_opt( 'enabled' );
	$show        = (string) unichat_opt( 'show' );
	$selected    = (string) unichat_opt( 'selected_ids' );
	$consent     = (bool) unichat_opt( 'consent' );
	$health_nonce = wp_create_nonce( 'unichat_health' );
	?>
	<div class="wrap unichat-settings">
		<h1>Universal Chat</h1>

		<?php if ( isset( $_GET['settings-updated'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Настройки сохранены.', 'uni-chat' ); ?></p></div>
		<?php endif; ?>

		<form method="post" action="options.php">
			<?php settings_fields( 'unichat' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="unichat-enabled"><?php esc_html_e( 'Включён', 'uni-chat' ); ?></label></th>
					<td>
						<label>
							<!-- hidden 0: снятый чекбокс не шлётся браузером — иначе опция не выключится -->
							<input type="hidden" name="<?php echo esc_attr( UNICHAT_OPTION_PREFIX ); ?>enabled" value="0">
							<input type="checkbox" id="unichat-enabled" name="<?php echo esc_attr( UNICHAT_OPTION_PREFIX ); ?>enabled" value="1" <?php checked( $enabled ); ?>>
							<?php esc_html_e( 'Показывать чат на сайте', 'uni-chat' ); ?>
						</label>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="unichat-server"><?php esc_html_e( 'Chat Server URL', 'uni-chat' ); ?></label></th>
					<td>
						<input type="url" class="regular-text code" id="unichat-server" name="<?php echo esc_attr( UNICHAT_OPTION_PREFIX ); ?>server_url" value="<?php echo esc_attr( $server ); ?>" placeholder="https://chat.example.com">
						<p class="description"><?php esc_html_e( 'Адрес вашего chat-сервера из админки Universal Chat.', 'uni-chat' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="unichat-key"><?php esc_html_e( 'Public Chat Key', 'uni-chat' ); ?></label></th>
					<td>
						<input type="text" class="regular-text code" id="unichat-key" name="<?php echo esc_attr( UNICHAT_OPTION_PREFIX ); ?>public_key" value="<?php echo esc_attr( $key ); ?>" placeholder="pk_live_...">
						<p class="description"><?php esc_html_e( 'Публичный ключ сайта: админка чата → Проект → Сайты → Показать сниппет.', 'uni-chat' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Где показывать', 'uni-chat' ); ?></th>
					<td>
						<label>
							<input type="radio" name="<?php echo esc_attr( UNICHAT_OPTION_PREFIX ); ?>show" value="all" <?php checked( $show, 'all' ); ?>>
							<?php esc_html_e( 'На всех страницах', 'uni-chat' ); ?>
						</label><br>
						<label>
							<input type="radio" name="<?php echo esc_attr( UNICHAT_OPTION_PREFIX ); ?>show" value="selected" <?php checked( $show, 'selected' ); ?>>
							<?php esc_html_e( 'Только на выбранных страницах (ID через запятую)', 'uni-chat' ); ?>
						</label><br>
						<input type="text" class="small-text code" name="<?php echo esc_attr( UNICHAT_OPTION_PREFIX ); ?>selected_ids" value="<?php echo esc_attr( $selected ); ?>" placeholder="2, 17, 42">
						<p class="description"><?php esc_html_e( 'Шорткод [uni_chat] включает чат на своей странице независимо от этого правила.', 'uni-chat' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="unichat-consent"><?php esc_html_e( 'Consent', 'uni-chat' ); ?></label></th>
					<td>
						<label>
							<input type="hidden" name="<?php echo esc_attr( UNICHAT_OPTION_PREFIX ); ?>consent" value="0">
							<input type="checkbox" id="unichat-consent" name="<?php echo esc_attr( UNICHAT_OPTION_PREFIX ); ?>consent" value="1" <?php checked( $consent ); ?>>
							<?php esc_html_e( 'Не загружать чат до согласия на cookies (WP Consent API)', 'uni-chat' ); ?>
						</label>
						<p class="description"><?php esc_html_e( 'Требуется активный consent-плагин с поддержкой WP Consent API.', 'uni-chat' ); ?></p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<hr>
		<h2><?php esc_html_e( 'Проверка соединения', 'uni-chat' ); ?></h2>
		<p>
			<button type="button" class="button button-secondary" id="unichat-health-check"
				data-nonce="<?php echo esc_attr( $health_nonce ); ?>">
				<?php esc_html_e( 'Проверить соединение', 'uni-chat' ); ?>
			</button>
			<span id="unichat-health-result" aria-live="polite"></span>
		</p>
		<p class="description">
			<?php
			printf(
				/* translators: %s: endpoint path */
				esc_html__( 'Вызывается %s на настроенном сервере. Других исходящих запросов плагин не делает.', 'uni-chat' ),
				'<code>GET /widget/v1/health</code>'
			);
			?>
		</p>

		<script>
		(function () {
			var btn = document.getElementById('unichat-health-check');
			var out = document.getElementById('unichat-health-result');
			if (!btn || !out) return;
			btn.addEventListener('click', function () {
				out.textContent = '<?php echo esc_js( __( 'Проверяю…', 'uni-chat' ) ); ?>';
				out.className = '';
				var body = new URLSearchParams({ action: 'unichat_health', nonce: btn.dataset.nonce });
				fetch(<?php echo wp_json_encode( admin_url( 'admin-ajax.php' ) ); ?>, {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
					body: body.toString()
				}).then(function (r) { return r.json(); }).then(function (j) {
					if (j && j.success) {
						out.textContent = '<?php echo esc_js( __( 'Соединение ок. Версия сервера:', 'uni-chat' ) ); ?> ' + (j.data.version || '?');
						out.className = 'unichat-ok';
					} else {
						out.textContent = '<?php echo esc_js( __( 'Ошибка:', 'uni-chat' ) ); ?> ' + ((j && j.data && j.data.message) || 'неизвестная ошибка');
						out.className = 'unichat-bad';
					}
				}).catch(function () {
					out.textContent = '<?php echo esc_js( __( 'Сетевая ошибка запроса к админке.', 'uni-chat' ) ); ?>';
					out.className = 'unichat-bad';
				});
			});
		})();
		</script>
	</div>
	<?php
}
