/* Browser-local shared state for Budget Capture pages.
 * Financial data stays in this browser's IndexedDB. Nothing is uploaded.
 */
(function () {
  'use strict';
  const DATABASE_NAME = 'budget-capture-local-v1';
  const STORE_NAME = 'records';
  const CHANNEL_NAME = 'budget-capture-local-sync-v1';
  let channel = null;
  try { if ('BroadcastChannel' in window) channel = new BroadcastChannel(CHANNEL_NAME); } catch {}

  function openStore() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is unavailable in this browser.'));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local browser storage.'));
      request.onblocked = () => reject(new Error('Local browser storage is blocked by another tab.'));
    });
  }

  async function put(record) {
    const db = await openStore();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save local browser data.'));
        tx.onabort = () => reject(tx.error || new Error('Local browser save was cancelled.'));
      });
    } finally { db.close(); }
  }

  async function get(key) {
    const db = await openStore();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Could not read local browser data.'));
      });
    } finally { db.close(); }
  }

  function asArrayBuffer(bytes) {
    if (bytes instanceof ArrayBuffer) return bytes.slice(0);
    if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    throw new TypeError('Expected SQLite database bytes.');
  }

  async function saveDatabase(name, bytes) {
    const updatedAt = new Date().toISOString();
    await put({ key: 'active-database', name: String(name || 'MyBudget.budget'), bytes: asArrayBuffer(bytes), updatedAt });
    try { channel?.postMessage({ type: 'database-updated', updatedAt }); } catch {}
    return updatedAt;
  }

  async function loadDatabase() { return get('active-database'); }
  async function saveSetting(key, value) {
    await put({ key: 'setting:' + String(key), value, updatedAt: new Date().toISOString() });
  }
  async function loadSetting(key) {
    const record = await get('setting:' + String(key));
    return record?.value ?? null;
  }
  function subscribe(callback) {
    if (!channel || typeof callback !== 'function') return () => {};
    const listener = event => {
      if (event.data?.type === 'database-updated') callback(event.data);
    };
    channel.addEventListener('message', listener);
    return () => channel.removeEventListener('message', listener);
  }

  window.BudgetSharedDb = Object.freeze({ saveDatabase, loadDatabase, saveSetting, loadSetting, subscribe });
})();
