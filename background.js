// ─── IndexedDB Setup ─────────────────────────────────────────────────────────

const DB_NAME = 'CheckpointDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        const ps = db.createObjectStore('projects', { keyPath: 'id' });
        ps.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('checkpoints')) {
        const cs = db.createObjectStore('checkpoints', { keyPath: 'id' });
        cs.createIndex('projectId', 'projectId', { unique: false });
        cs.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-checkpoint',
    title: 'Save as Checkpoint ✦',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-checkpoint' && info.selectionText) {
    chrome.storage.session.set({ pendingText: info.selectionText });
    chrome.action.openPopup();
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true; // keep channel open for async
});

async function handleMessage(msg) {
  const db = await openDB();

  switch (msg.type) {

    case 'GET_PROJECTS': {
      const projects = await getAll(db, 'projects');
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      return { projects };
    }

    case 'CREATE_PROJECT': {
      const project = {
        id: uid(),
        name: msg.name.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await put(db, 'projects', project);
      return { project };
    }

    case 'DELETE_PROJECT': {
      // delete all checkpoints of this project first
      const all = await getByIndex(db, 'checkpoints', 'projectId', msg.projectId);
      for (const cp of all) await del(db, 'checkpoints', cp.id);
      await del(db, 'projects', msg.projectId);
      return { ok: true };
    }

    case 'GET_CHECKPOINTS': {
      const checkpoints = await getByIndex(db, 'checkpoints', 'projectId', msg.projectId);
      checkpoints.sort((a, b) => b.createdAt - a.createdAt);
      return { checkpoints };
    }

    case 'SAVE_CHECKPOINT': {
      const cp = {
        id: uid(),
        projectId: msg.projectId,
        name: msg.name.trim(),
        text: msg.text,
        notes: msg.notes || '',
        tags: msg.tags || [],
        rating: msg.rating || 5,
        gold: msg.gold || false,
        createdAt: Date.now()
      };
      await put(db, 'checkpoints', cp);
      // update project timestamp
      const proj = await get(db, 'projects', msg.projectId);
      if (proj) { proj.updatedAt = Date.now(); await put(db, 'projects', proj); }
      return { checkpoint: cp };
    }

    case 'UPDATE_CHECKPOINT': {
      const cp = await get(db, 'checkpoints', msg.id);
      if (!cp) return { error: 'Not found' };
      Object.assign(cp, msg.updates);
      await put(db, 'checkpoints', cp);
      return { checkpoint: cp };
    }

    case 'DELETE_CHECKPOINT': {
      await del(db, 'checkpoints', msg.id);
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ─── IndexedDB Helpers ────────────────────────────────────────────────────────

function getAll(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function get(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function put(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function del(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getByIndex(db, store, index, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).index(index).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
