import { fetchJson } from '../sources/http.ts';

export interface Notifier {
  readonly channel: string;
  send(html: string): Promise<void>;
}

/** Telegram — практичный канал для этой задачи: приходит на телефон и не теряется в почте. */
export class TelegramNotifier implements Notifier {
  readonly channel = 'telegram';

  #botToken: string;
  #chatId: string;

  constructor(botToken: string, chatId: string) {
    this.#botToken = botToken;
    this.#chatId = chatId;
  }

  async send(html: string): Promise<void> {
    await fetchJson(`https://api.telegram.org/bot${this.#botToken}/sendMessage`, {
      method: 'POST',
      body: {
        chat_id: this.#chatId,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      },
    });
  }
}

/** Используется, пока бот не подключён: тот же поток алертов, но в stdout. */
export class ConsoleNotifier implements Notifier {
  readonly channel = 'console';

  async send(html: string): Promise<void> {
    console.log(`\n${stripHtml(html)}\n${'─'.repeat(60)}`);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, '$2: $1')
    .replace(/<\/?[a-z]+>/gi, '');
}
