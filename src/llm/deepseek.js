const fetch = require('node-fetch');

class DeepSeekClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.deepseek.com/v1';
  }

  async chat(messages, options) {
    if (!this.apiKey) throw new Error('DeepSeek API key not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: options?.model ?? 'deepseek-chat',
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 1024
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!resp.ok) { const text = await resp.text().catch(() => ''); throw new Error(`DeepSeek API error: ${resp.status} ${text}`); }
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('DeepSeek returned empty choices');
      return content;
    } catch (e) { clearTimeout(timeout); throw e; }
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

module.exports = { DeepSeekClient };
