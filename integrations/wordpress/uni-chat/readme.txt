=== Universal Chat ===
Contributors: unichat
Tags: chat, support, ai, widget, live-chat
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Тонкая интеграция чата Universal Chat: настройки + вставка widget.js. Без бизнес-логики.

== Description ==

Плагин подключает ваш WordPress-сайт к self-hosted платформе чата Universal Chat.

* Установка ≤ 5 минут: URL сервера + публичный ключ из админки чата.
* Вставка виджета через `wp_footer` — правка темы не нужна.
* «Где показывать»: все страницы или выбранные по ID; шорткод `[uni_chat]` для отдельной страницы.
* Health check одной кнопкой (`GET /widget/v1/health`).
* Consent-режим (WP Consent API): скрипт не грузится до согласия на cookies.
* Multisite: у каждого подсайта свои настройки и свой ключ.

Плагин не содержит бизнес-логики: диалоги, AI и хранение — на вашем chat-сервере.
Секретов в плагине нет: публичный ключ (`pk_...`) предназначен для встраивания.

== Installation ==

1. WP Admin → Plugins → Add New → Upload Plugin → uni-chat.zip → Install Now → Activate.
2. Меню «Universal Chat» → укажите Chat Server URL и Public Chat Key (админка чата → Проект → Сайты → Показать сниппет).
3. Отметьте «Включён», при необходимости нажмите «Проверить соединение».
4. Добавьте домен сайта в allowed_origins сайта в админке чата.

== Frequently Asked Questions ==

= Кнопка чата не появляется =

Проверьте: плагин включён, опция «Включён» отмечена, страница подходит под правило «Где показывать», домен сайта добавлен в allowed_origins в админке чата.

= Health check красный =

Неверный Chat Server URL или сервер недоступен. Проверьте адрес и HTTPS.

= INVALID_ORIGIN в консоли браузера =

Домен сайта не в allowlist сайта в админке чата (Проект → Сайты → allowed_origins).

== Changelog ==

= 0.1.0 =
* Первый релиз: настройки, embed через wp_footer, health check, consent (WP Consent API), шорткод [uni_chat], multisite per-site настройки.
