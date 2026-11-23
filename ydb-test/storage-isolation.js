(() => {
  const storage = window.localStorage;
  const proto = Storage.prototype;
  const prefix = 'assistant-ydb-test:';
  const get = proto.getItem;
  const set = proto.setItem;
  const remove = proto.removeItem;
  const clear = proto.clear;
  const key = proto.key;
  Object.defineProperties(proto, {
    getItem: { configurable: true, value(name) { return get.call(this, prefix + name); } },
    setItem: { configurable: true, value(name, value) { return set.call(this, prefix + name, value); } },
    removeItem: { configurable: true, value(name) { return remove.call(this, prefix + name); } },
    clear: { configurable: true, value() {
      const keys = [];
      for (let i = 0; i < this.length; i++) { const k = key.call(this, i); if (k && k.startsWith(prefix)) keys.push(k); }
      for (const k of keys) remove.call(this, k);
    } },
    key: { configurable: true, value(index) {
      const keys = [];
      for (let i = 0; i < this.length; i++) { const k = key.call(this, i); if (k && k.startsWith(prefix)) keys.push(k.slice(prefix.length)); }
      return keys[index] ?? null;
    } }
  });
  void storage;
})();
