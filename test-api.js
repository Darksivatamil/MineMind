require('dotenv').config();
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'settings.json'), 'utf8'));
const apiKey = process.env.NVIDIA_API_KEY || settings.apiKeys?.nvidia;
if (!apiKey) {
  console.error('FAIL: no NVIDIA key found. Set NVIDIA_API_KEY in .env or config/settings.json');
  process.exit(1);
}
const baseUrl = settings.llm?.nvidiaBaseUrl || 'https://integrate.api.nvidia.com/v1';
const model = settings.llm?.model;

const keyPreview = apiKey?.slice(0, 12) + '...' + apiKey?.slice(-4);
console.log(`Model: ${model}`);
console.log(`Key:   ${keyPreview}\n`);

(async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const start = Date.now();
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are AGNES, a real Tamil girl. Talk natural Tunglish (Tamil+English). Short 1 sentence.' },
          { role: 'user', content: 'agnes! I found diamonds!' }
        ],
        temperature: 0.8,
        max_tokens: 80
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`FAIL: HTTP ${resp.status} — ${text.slice(0, 200)}`);
      process.exit(1);
    }
    const data = await resp.json();
    const reply = data.choices[0].message.content.trim();
    console.log(`OK (${Date.now() - start}ms)`);
    console.log(`"${reply}"`);
  } catch (e) {
    clearTimeout(timeout);
    console.error(`FAIL: ${e.message}`);
    process.exit(1);
  }
})();
