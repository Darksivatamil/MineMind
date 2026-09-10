const readline = require('readline');

class TerminalChat {
  constructor(bot) {
    this.bot = bot;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.rl.on('line', (line) => {
      const cmd = line.trim();
      const bot = this.bot;
      if (cmd && bot) {
        try { bot.chat(cmd); } catch (e) { console.warn('terminal chat err:', e.message); }
      }
    });
  }

  setBot(bot) {
    this.bot = bot;
  }

  stop() {
    try { if (this.rl) this.rl.close(); } catch (e) { console.warn('terminal close err:', e.message); }
  }
}

module.exports = { TerminalChat };
