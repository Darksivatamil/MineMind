const fetch = require('node-fetch');

// OpenRouter: OpenAI-compatible gateway. Any model id works, e.g.
//  - "google/gemini-2.5-flash"            (Gemini 2.5 Flash via OpenRouter)
//  - "qwen/qwen3-32b" / Ling-family ids   (user asked for "ling 3.0 flash" style models)
// Set OPENROUTER_API_KEY + llm.openRouterModel / llm.openRouterModels in settings.
class OpenRouterClient {
  constructor(apiKey, baseUrl, model, extraModels) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || 'https://openrouter.ai/api/v1';
    const models = extraModels || [];
    this.primaryModel = model || models[0] || 'google/gemini-2.5-flash';
    this.fallbackModels = (models.length > 1 ? models.slice(1) : []);
  }

  async chat(messages, options) {
    if (!this.apiKey) throw new Error('OpenRouter API key not configured');
    const optModel = options?.openRouterModel || options?.model;
    const models = optModel ? [optModel, ...this.fallbackModels] : [this.primaryModel, ...this.fallbackModels];
    const url = `${this.baseUrl}/chat/completions`;
    const errors = [];

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://github.com/MineMind-AGNES',
            'X-Title': 'AGNES Minecraft Bot'
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: options?.temperature ?? 0.8,
            max_tokens: options?.maxTokens ?? 60
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          errors.push(`${model}: HTTP ${resp.status} ${text.slice(0, 160)}`);
          continue;
        }
        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) { errors.push(`${model}: empty choices`); continue; }
        return content;
      } catch (e) {
        clearTimeout(timeout);
        errors.push(`${model}: ${e.message}`);
        continue;
      }
    }
    throw new Error(`All OpenRouter models failed: ${errors.join('; ')}`);
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

module.exports = { OpenRouterClient };
