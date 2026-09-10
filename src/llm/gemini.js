const fetch = require('node-fetch');

class GeminiClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  }

  async chat(messages, options) {
    if (!this.apiKey) throw new Error('Gemini API key not configured');
    let systemInstruction = null;
    const contents = messages.filter(m => {
      if (m.role === 'system') { systemInstruction = m.content; return false; }
      return true;
    }).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const body = { contents, generationConfig: { temperature: options?.temperature ?? 0.7, maxOutputTokens: options?.maxTokens ?? 1024 } };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(
        `${this.baseUrl}/models/${options?.geminiModel || options?.model || 'gemini-2.5-flash'}:generateContent?key=${this.apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }
      );
      clearTimeout(timeout);
      if (!resp.ok) { const text = await resp.text(); throw new Error(`Gemini API error ${resp.status}: ${text}`); }
      const data = await resp.json();
      if (!data.candidates || data.candidates.length === 0) throw new Error('Gemini returned no candidates');
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini returned empty content (possibly SAFETY block)');
      return text;
    } catch (e) { clearTimeout(timeout); throw e; } finally { clearTimeout(timeout); }
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

module.exports = { GeminiClient };
