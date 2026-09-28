const { DeepSeekClient } = require('./deepseek');
const { OpenAIClient } = require('./openai');
const { GeminiClient } = require('./gemini');
const { NvidiaClient } = require('./nvidia');
const { OpenRouterClient } = require('./openrouter');

class ProviderManager {
  constructor(settings) {
    this.settings = settings || {};
    this.providers = {};
    // Lazy-safe construction: one failing provider must not kill the whole manager
    try { this.providers.deepseek = new DeepSeekClient(process.env.DEEPSEEK_API_KEY || settings.apiKeys?.deepseek); } catch (e) { console.error('deepseek init failed:', e.message); }
    try { this.providers.openai = new OpenAIClient(process.env.OPENAI_API_KEY || settings.apiKeys?.openai); } catch (e) { console.error('openai init failed:', e.message); }
    try { this.providers.gemini = new GeminiClient(process.env.GEMINI_API_KEY || settings.apiKeys?.gemini); } catch (e) { console.error('gemini init failed:', e.message); }
    try {
      this.providers.nvidia = new NvidiaClient(
        process.env.NVIDIA_API_KEY || settings.apiKeys?.nvidia,
        settings.llm?.nvidiaBaseUrl,
        settings.llm?.model,
        settings.llm?.nvidiaModels
      );
    } catch (e) { console.error('nvidia init failed:', e.message); }
    try {
      this.providers.openrouter = new OpenRouterClient(
        process.env.OPENROUTER_API_KEY || settings.apiKeys?.openrouter,
        settings.llm?.openRouterBaseUrl,
        process.env.OPENROUTER_MODEL || settings.llm?.openRouterModel,
        settings.llm?.openRouterModels
      );
    } catch (e) { console.error('openrouter init failed:', e.message); }
    this.primary = settings.llm?.primary || 'nvidia';
    this.fallback = settings.llm?.fallback || 'gemini';
    this.modelOrder = settings.llm?.providerOrder || ['openrouter', 'nvidia', 'gemini', 'openai', 'deepseek'];
    this.lastError = null;
  }

  async sendMessage(systemPrompt, userMessage) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];
    return this._chat(messages);
  }

  async sendRaw(messages, opts = {}) {
    return this._chat(messages, opts);
  }

  async sendTo(providerName, messages, opts = {}) {
    const provider = this.providers[providerName];
    if (!provider) throw new Error(`Unknown provider: ${providerName}`);
    if (!provider.isAvailable()) throw new Error(`${providerName} is not available`);
    // Keep model selectors (geminiModel/model/openRouterModel/...) so each
    // provider resolves its own model. Only strip routing-only keys.
    const { primary, fallback, providerOrder, ...cleanLlm } = (this.settings.llm || {});
    return provider.chat(messages, { ...cleanLlm, ...opts });
  }

  async _chat(messages, opts = {}) {
    const { primary, fallback, providerOrder, ...cleanLlm } = (this.settings.llm || {});
    const llmOpts = { ...cleanLlm, ...opts };
    const ordered = this.modelOrder;

    const errors = [];
    for (const name of ordered) {
      const provider = this.providers[name];
      if (!provider) { console.warn(`LLM provider '${name}' in providerOrder not found, skipping`); continue; }
      if (provider && provider.isAvailable()) {
        try {
          const result = await provider.chat(messages, llmOpts);
          this.lastError = null;
          return result;
        } catch (e) {
          this.lastError = e.message;
          errors.push(`${name}: ${e.message}`);
        }
      }
    }

    throw new Error(`All LLM providers failed: ${errors.join('; ')}`);
  }

  isAvailable() {
    return Object.values(this.providers).some(p => p.isAvailable());
  }
}

module.exports = { ProviderManager };
