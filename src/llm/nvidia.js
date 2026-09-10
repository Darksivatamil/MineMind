const fetch = require('node-fetch');

class NvidiaClient {
  constructor(apiKey, baseUrl, model, extraModels) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || 'https://integrate.api.nvidia.com/v1';
    const models = extraModels || [];
    this.primaryModel = model || models[0] || 'deepseek-ai/deepseek-v3';
    this.fallbackModels = (models.length > 1 ? models.slice(1) : [
      'qwen/qwen3.5-122b-a10b',
      'meta/llama-3.3-70b-instruct'
    ]);
  }

  async chat(messages, options) {
    if (!this.apiKey) throw new Error('NVIDIA API key not configured');
    const models = [this.primaryModel, ...this.fallbackModels];
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
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 1024
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          errors.push(`${model}: HTTP ${resp.status} ${text}`);
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
    throw new Error(`All NVIDIA models failed: ${errors.join('; ')}`);
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

module.exports = { NvidiaClient };
