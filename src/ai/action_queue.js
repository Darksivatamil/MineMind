class ActionQueue {
  constructor() {
    this.queue = [];
    this.current = null;
    this._idCounter = 0;
  }

  add(action, priority) {
    const id = ++this._idCounter;
    const entry = { id, action, priority: priority || 0, added: Date.now() };
    this.queue.push(entry);
    this.queue.sort((a, b) => b.priority - a.priority);
    return id;
  }

  dequeue() {
    if (this.queue.length === 0) return null;
    this.current = this.queue.shift();
    return this.current;
  }

  peek() {
    return this.queue.length > 0 ? this.queue[0] : null;
  }

  remove(id) {
    this.queue = this.queue.filter(e => e.id !== id);
    if (this.current && this.current.id === id) {
      this.current = null;
    }
  }

  clear() {
    this.queue = [];
    this.current = null;
  }

  size() {
    return this.queue.length;
  }

  hasAction(type) {
    return this.queue.some(e => e.action && e.action.type === type) ||
      (this.current && this.current.action && this.current.action.type === type);
  }
}

module.exports = { ActionQueue };
