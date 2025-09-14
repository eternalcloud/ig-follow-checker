// app.js
let deferredPrompt;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn?.addEventListener('click', async () => {
  installBtn.hidden = true;
  await deferredPrompt.prompt();
  deferredPrompt = null;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}

// ------- IndexedDB helpers -------
const DB_NAME = 'ig-follow-tracker';
const DB_VER = 1;
const STORE_SNAP = 'snapshots';
const STORE_FOLLOWERS = 'followers';
const STORE_FOLLOWING = 'following';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(STORE_SNAP, { keyPath: 'id', autoIncrement: true });
      const f1 = db.createObjectStore(STORE_FOLLOWERS, { keyPath: ['snapshot_id', 'username'] });
      f1.createIndex('by_snapshot', 'snapshot_id');
      const f2 = db.createObjectStore(STORE_FOLLOWING, { keyPath: ['snapshot_id', 'username'] });
      f2.createIndex('by_snapshot', 'snapshot_id');
      f2.createIndex('by_snapshot_username', ['snapshot_id', 'username']);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    t.oncomplete = () => resolve(res);
    t.onerror = () => reject(t.error);
    let res;
    Promise.resolve(fn(t)).then((r) => { res = r; }).catch((e)=>reject(e));
  });
}

// ------- ZIP parsing via fflate -------
async function parseInstagramZip(file) {
  if (!self.fflate) throw new Error('Unzip library not loaded yet. Wait a moment and retry.');
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise((resolve, reject) => {
    fflate.unzip(buf, { filter: () => true }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  const files = Object.entries(entries)
    .map(([name, u8]) => [name, new TextDecoder('utf-8').decode(u8)]);

  const jsonTexts = (needle) => files
    .filter(([n]) => n.toLowerCase().includes(needle) && n.endsWith('.json'))
    .map(([, txt]) => txt);

  const followersTxts = jsonTexts('followers');
  const followingTxts = jsonTexts('following');

  if (!followersTxts.length || !followingTxts.length) {
    throw new Error('Followers/Following JSON not found inside ZIP.');
  }

  const followers = [];
  const following = [];

  function pluck(list) {
    const out = [];
    for (const item of list) {
      const sld = item?.string_list_data || [];
      for (const s of sld) {
        out.push({ username: s.value, ts: s.timestamp ? new Date(s.timestamp * 1000).toISOString() : null });
      }
    }
    return out;
  }

  for (const txt of followersTxts) {
    const arr = JSON.parse(txt);
    followers.push(...pluck(arr));
  }
  for (const txt of followingTxts) {
    const arr = JSON.parse(txt);
    following.push(...pluck(arr));
  }

  const dedup = (arr, key='username') => Array.from(new Map(arr.map(o => [o[key], o])).values());
  return { followers: dedup(followers), following: dedup(following) };
}

// ------- Persist snapshot -------
async function saveSnapshot(parsed, sourceFilename) {
  const db = await openDB();
  let newId;
  await tx(db, [STORE_SNAP, STORE_FOLLOWERS, STORE_FOLLOWING], 'readwrite', (t) => {
    const sStore = t.objectStore(STORE_SNAP);
    const takenAt = new Date().toISOString();
    const addReq = sStore.add({ taken_at: takenAt, source_filename: sourceFilename });
    addReq.onsuccess = () => {
      newId = addReq.result;
      const folStore = t.objectStore(STORE_FOLLOWERS);
      const fngStore = t.objectStore(STORE_FOLLOWING);
      for (const f of parsed.followers) {
        folStore.add({ snapshot_id: newId, username: f.username });
      }
      for (const g of parsed.following) {
        fngStore.add({ snapshot_id: newId, username: g.username, followed_at: g.ts });
      }
    };
  });
  return newId;
}

// ------- Queries -------
async function listSnapshots() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SNAP, 'readonly');
    const s = t.objectStore(STORE_SNAP);
    const out = [];
    s.openCursor(null, 'prev').onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { out.push({ id: cur.key, ...cur.value }); cur.continue(); }
    };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}

async function getSet(store, snapshotId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const os = t.objectStore(store).index('by_snapshot');
    const req = os.getAll(snapshotId);
    req.onsuccess = () => {
      if (store === STORE_FOLLOWERS) {
        resolve(new Set(req.result.map(r => r.username)));
      } else {
        const map = new Map();
        for (const r of req.result) map.set(r.username, r.followed_at || null);
        resolve(map);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function computeUnfollowers() {
  const snaps = await listSnapshots();
  if (snaps.length < 2) return [];
  const cur = snaps[0], prev = snaps[1];
  const curF = await getSet(STORE_FOLLOWERS, cur.id);
  const prevF = await getSet(STORE_FOLLOWERS, prev.id);

  const out = [];
  for (const u of prevF) if (!curF.has(u)) out.push({ username: u, last_seen: prev.taken_at });
  out.sort((a,b) => a.username.localeCompare(b.username));
  return out;
}

async function computeNotBack() {
  const snaps = await listSnapshots();
  if (!snaps.length) return [];
  const cur = snaps[0];
  const curFollowers = await getSet(STORE_FOLLOWERS, cur.id);
  const followingMap = await getSet(STORE_FOLLOWING, cur.id);
  const out = [];
  for (const [u, ts] of followingMap.entries()) {
    if (!curFollowers.has(u)) out.push({ username: u, followed_at: ts });
  }
  out.sort((a,b) => a.username.localeCompare(b.username));
  return out;
}

// ------- UI wiring -------
const zipInput = document.getElementById('zipInput');
const importStatus = document.getElementById('importStatus');
const snapshotsDiv = document.getElementById('snapshots');
const unfollowersDiv = document.getElementById('unfollowers');
const notBackDiv = document.getElementById('notBack');
const resetBtn = document.getElementById('resetBtn');
const csvUnfollowersBtn = document.getElementById('csvUnfollowers');
const csvNotBackBtn = document.getElementById('csvNotBack');

zipInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  await handleZipFile(file);
  zipInput.value = '';
});

async function handleZipFile(file) {
  try {
    importStatus.textContent = 'Importing…';
    const parsed = await parseInstagramZip(file);
    await saveSnapshot(parsed, file.name);
    importStatus.textContent = `Imported: ${parsed.followers.length} followers, ${parsed.following.length} following`;
    await refreshAll();
  } catch (err) {
    console.error(err);
    importStatus.textContent = `Import failed: ${err.message || err}`;
  }
}

async function refreshAll() {
  const snaps = await listSnapshots();
  if (!snaps.length) {
    snapshotsDiv.innerHTML = '<div class="empty">No snapshots yet.</div>';
  } else {
    snapshotsDiv.innerHTML = '<div class="list">' + snaps.map(s =>
      `<div class="row">
        <div><b>Snapshot #${s.id}</b> <span class="badge">taken ${new Date(s.taken_at).toLocaleString()}</span><div class="small">${s.source_filename || ''}</div></div>
        <div></div>
      </div>`
    ).join('') + '</div>';
  }

  const unf = await computeUnfollowers();
  unfollowersDiv.innerHTML = unf.length
    ? '<div class="list">' + unf.map(x => `<div class="row"><div>${x.username}</div><div class="small">last seen: ${new Date(x.last_seen).toLocaleDateString()}</div></div>`).join('') + '</div>'
    : '<div class="empty">None (need at least two snapshots).</div>';

  const nb = await computeNotBack();
  notBackDiv.innerHTML = nb.length
    ? '<div class="list">' + nb.map(x => `<div class="row"><div>${x.username}</div><div class="small">${x.followed_at ? 'followed: ' + new Date(x.followed_at).toLocaleDateString() : ''}</div></div>`).join('') + '</div>'
    : '<div class="empty">None (or no current snapshot).</div>';
}

resetBtn.addEventListener('click', async () => {
  if (!confirm('This will erase all local data for this app on this device. Continue?')) return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction([STORE_SNAP, STORE_FOLLOWERS, STORE_FOLLOWING], 'readwrite');
    t.objectStore(STORE_SNAP).clear();
    t.objectStore(STORE_FOLLOWERS).clear();
    t.objectStore(STORE_FOLLOWING).clear();
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
  await refreshAll();
});

function toCSV(rows, header) {
  const esc = (s)=> `"${String(s ?? '').replace(/"/g,'""')}"`;
  const lines = [header.join(','), ...rows.map(r => header.map(h => esc(r[h])).join(','))];
  return new Blob([lines.join('\n')], { type: 'text/csv' });
}
csvUnfollowersBtn.addEventListener('click', async () => {
  const data = await computeUnfollowers();
  const blob = toCSV(data, ['username','last_seen']);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'unfollowers.csv' });
  a.click(); URL.revokeObjectURL(url);
});
csvNotBackBtn.addEventListener('click', async () => {
  const data = await computeNotBack();
  const blob = toCSV(data, ['username','followed_at']);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'not_following_back.csv' });
  a.click(); URL.revokeObjectURL(url);
});

navigator.serviceWorker?.addEventListener('message', async (event) => {
  if (event.data?.type === 'SHARE_TARGET_ZIP') {
    const file = event.data.file;
    if (file) await handleZipFile(file);
  }
});

refreshAll();
