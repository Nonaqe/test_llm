/**
 * Стили виджета — целиком внутри Shadow DOM (изоляция, docs/08 §2).
 * Единственная точка проникновения стилей сайта — CSS-переменные --uni-chat-*
 * (docs/08 §4, уровень 2). Собственный reset в начале.
 */
export const WIDGET_STYLES = `
  :host {
    all: initial;
    --_accent: var(--uni-chat-accent, #4f46e5);
    --_accent-contrast: var(--uni-chat-accent-contrast, #ffffff);
    --_bg: var(--uni-chat-bg, #ffffff);
    --_fg: var(--uni-chat-fg, #111827);
    --_bubble-ai: var(--uni-chat-bubble-ai, #f3f4f6);
    --_radius: var(--uni-chat-radius, 12px);
    --_bottom: var(--uni-chat-position-bottom, 20px);
    --_z: var(--uni-chat-z-index, 2147483000);
    --_font: var(--uni-chat-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
    --_size: var(--uni-chat-font-size, 15px);
    position: fixed;
    right: 20px;
    bottom: var(--_bottom);
    z-index: var(--_z);
    font-family: var(--_font);
    font-size: var(--_size);
    color: var(--_fg);
  }
  :host([position="left"]) { right: auto; left: 20px; }
  * { box-sizing: border-box; margin: 0; padding: 0; font: inherit; color: inherit; }

  .launcher {
    position: relative;
    width: 56px; height: 56px;
    border-radius: 50%;
    border: none;
    background: var(--_accent);
    color: var(--_accent-contrast);
    font-size: 24px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(0,0,0,.25);
  }
  .badge {
    display: none;
    position: absolute; top: -4px; right: -4px;
    min-width: 20px; height: 20px;
    border-radius: 10px;
    background: #ef4444; color: #fff;
    font-size: 12px; line-height: 20px; text-align: center;
    padding: 0 5px;
  }
  .badge.visible { display: block; }

  .panel {
    position: absolute;
    right: 0; bottom: 68px;
    width: min(360px, calc(100vw - 40px));
    height: min(520px, calc(100vh - 120px));
    display: none;
    flex-direction: column;
    background: var(--_bg);
    border-radius: var(--_radius);
    box-shadow: 0 12px 40px rgba(0,0,0,.22);
    overflow: hidden;
  }
  .panel.open { display: flex; }

  header {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 14px;
    background: var(--_accent); color: var(--_accent-contrast);
  }
  header .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #9ca3af; flex: none;
  }
  header .dot.on { background: #34d399; }
  /* Операторы онлайн (presence:operators) — синий оттенок поверх статуса соединения */
  header .dot.operator { box-shadow: 0 0 0 2px #60a5fa; }
  header .title { flex: 1; font-weight: 600; font-size: 14px; }
  header button {
    background: none; border: none; cursor: pointer;
    color: inherit; font-size: 20px; line-height: 1;
  }

  .messages {
    flex: 1; overflow-y: auto;
    padding: 14px;
    display: flex; flex-direction: column; gap: 8px;
    background: var(--_bg);
  }
  .row { display: flex; flex-direction: column; max-width: 82%; }
  .row.visitor { align-self: flex-end; align-items: flex-end; }
  .row.assistant, .row.operator { align-self: flex-start; align-items: flex-start; }
  .row.system { align-self: center; max-width: 92%; }
  .bubble {
    padding: 8px 12px;
    border-radius: var(--_radius);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.45;
  }
  .row.visitor .bubble { background: var(--_accent); color: var(--_accent-contrast); border-bottom-right-radius: 4px; }
  .row.assistant .bubble, .row.operator .bubble { background: var(--_bubble-ai); border-bottom-left-radius: 4px; }
  .row.system .bubble { background: transparent; color: #6b7280; font-size: 13px; text-align: center; }
  .time { font-size: 11px; color: #9ca3af; margin: 2px 4px 0; }

  .typing { display: none; align-self: flex-start; padding: 10px 14px; }
  .typing.visible { display: block; }
  .typing .dot-anim {
    display: inline-block; width: 6px; height: 6px; margin-right: 3px;
    border-radius: 50%; background: #9ca3af;
    animation: uni-blink 1.2s infinite;
  }
  .typing .dot-anim:nth-child(2) { animation-delay: .2s; }
  .typing .dot-anim:nth-child(3) { animation-delay: .4s; }
  @keyframes uni-blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

  .statusline {
    display: none;
    padding: 6px 14px;
    font-size: 12px; color: #6b7280;
    background: var(--_bg);
    border-top: 1px solid #f3f4f6;
  }
  .statusline.visible { display: block; }

  form.input-row {
    display: flex; gap: 8px;
    padding: 10px;
    border-top: 1px solid #e5e7eb;
    background: var(--_bg);
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  }
  form.input-row textarea {
    flex: 1;
    resize: none;
    border: 1px solid #e5e7eb;
    border-radius: var(--_radius);
    padding: 9px 12px;
    max-height: 96px;
    outline: none;
    background: var(--_bg);
  }
  form.input-row textarea:focus { border-color: var(--_accent); }
  form.input-row button {
    flex: none;
    border: none; border-radius: var(--_radius);
    background: var(--_accent); color: var(--_accent-contrast);
    padding: 0 14px;
    cursor: pointer;
    font-weight: 600;
  }
  form.input-row button:disabled { opacity: .5; cursor: default; }

  @media (max-width: 480px) {
    .panel {
      position: fixed;
      inset: 0;
      width: 100vw; height: 100vh;
      height: 100dvh;
      border-radius: 0;
      bottom: 0;
    }
    :host { bottom: calc(var(--_bottom) + env(safe-area-inset-bottom, 0px)); }
    .row { max-width: 90%; }
  }
`;
