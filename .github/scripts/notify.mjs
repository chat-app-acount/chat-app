// ChatSpace 通知（GitHub Actions）
// 1回の実行で約5分間、7秒おきに新着を確認します。

import { createSign } from 'node:crypto';

const PROJECT = 'chat-app-44d95';
const SITE = 'https://chat-app-acount.github.io/chat-app/';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const sa = JSON.parse(process.env.SERVICE_ACCOUNT);

const RUN_SECONDS = 290;   // 1回の実行の長さ
const INTERVAL_MS = 7000; // 確認の間隔（5秒より短くしないでください：Firestoreの無料枠を超えます）

const b64u = b => Buffer.from(b).toString('base64url');
const str = f => (f && f.stringValue) || '';
const strs = f => ((f && f.arrayValue && f.arrayValue.values) || []).map(v => v.stringValue).filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let tokenCache = { t: null, exp: 0 };
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.t && tokenCache.exp > now + 120) return tokenCache.t;
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const sig = createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + head + '.' + claim + '.' + b64u(sig)
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('認証に失敗しました: ' + JSON.stringify(j));
  tokenCache = { t: j.access_token, exp: now + 3500 };
  return tokenCache.t;
}

let last = null, lastSaved = 0;

async function persist(at, iso) {
  await fetch(`${FS}/meta/push?updateMask.fieldPaths=lastTs`, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { lastTs: { timestampValue: iso } } })
  });
  lastSaved = Date.now();
}

async function poll() {
  const started = new Date();
  const at = await accessToken();
  const H = { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' };
  const get = async p => { const r = await fetch(`${FS}/${p}`, { headers: H }); return r.ok ? r.json() : null; };
  if (!last) {
    const meta = await get('meta/push');
    if (!meta || !meta.fields || !meta.fields.lastTs) { await persist(at, started.toISOString()); last = started.toISOString(); console.log('初回の準備が完了しました'); return 0; }
    last = meta.fields.lastTs.timestampValue;
  }
  const since = new Date(Date.parse(last) - 30000).toISOString();

  const userCache = {};
  const getUser = async uid => userCache[uid] || (userCache[uid] = ((await get('users/' + uid)) || {}).fields || {});

  const todo = {}; // uid -> [{col, roomId, roomName, author, text}]
  for (const col of ['rooms', 'dms']) {
    // 最近動きのあったルームだけを取得（読み取り回数を抑えるため）
    const rr = await fetch(`${FS}:runQuery`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: col }],
        where: { fieldFilter: { field: { fieldPath: 'lastMsgTs' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: since } } },
        limit: 100
      } })
    });
    if (!rr.ok) { console.log('room query failed', col, rr.status); continue; }
    for (const row of await rr.json()) {
      const d = row.document; if (!d) continue;
      const roomId = d.name.split('/').pop(), f = d.fields || {};
      const members = strs(f.members);
      const q = await fetch(`${FS}/${col}/${roomId}:runQuery`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: 'messages' }],
          select: { fields: ['type','author','text','stamp','deleted','readBy','hasImage'].map(f => ({ fieldPath: f })) },
          where: { fieldFilter: { field: { fieldPath: 'ts' }, op: 'GREATER_THAN', value: { timestampValue: last } } },
          orderBy: [{ field: { fieldPath: 'ts' }, direction: 'ASCENDING' }],
          limit: 50
        } })
      });
      if (!q.ok) { console.log('query failed', col, roomId, q.status); continue; }
      for (const r2 of await q.json()) {
        const m = r2.document && r2.document.fields; if (!m) continue;
        if (str(m.type) === 'system' || (m.deleted && m.deleted.booleanValue)) continue;
        const author = str(m.author), readBy = strs(m.readBy);
        const text = m.hasImage && m.hasImage.booleanValue ? '画像を送信しました' : (m.stamp && m.stamp.booleanValue ? 'スタンプ ' : '') + str(m.text);
        for (const u of members) {
          if (u === author || readBy.includes(u)) continue;
          (todo[u] = todo[u] || []).push({ col, roomId, roomName: str(f.name), author, text });
        }
      }
    }
  }

  const dead = {};
  let sent = 0;
  for (const [uid, items] of Object.entries(todo)) {
    const tokens = strs((await getUser(uid)).fcmTokens);
    if (!tokens.length) continue;
    const byRoom = {};
    items.forEach(i => (byRoom[i.col + '/' + i.roomId] = byRoom[i.col + '/' + i.roomId] || []).push(i));
    for (const list of Object.values(byRoom)) {
      const li = list[list.length - 1];
      const senderName = str((await getUser(li.author)).name) || 'ChatSpace';
      const title = li.col === 'dms' ? senderName : (li.roomName || 'ChatSpace');
      const prefix = list.length > 1 ? `${list.length}件の新着 ` : '';
      const body = (li.col === 'rooms' ? senderName + ': ' : '') + prefix + li.text.slice(0, 100);
      for (const token of tokens) {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ message: { token, data: { title, body, roomId: li.roomId },
            webpush: { headers: { Urgency: 'high' }, fcm_options: { link: SITE + '?room=' + li.roomId } } } })
        });
        if (r.ok) sent++;
        else if (r.status === 404) (dead[uid] = dead[uid] || new Set()).add(token);
        else console.log('send failed', r.status, await r.text());
      }
    }
  }

  const writes = Object.entries(dead).map(([u, set]) => ({ transform: {
    document: `projects/${PROJECT}/databases/(default)/documents/users/${u}`,
    fieldTransforms: [{ fieldPath: 'fcmTokens', removeAllFromArray: { values: [...set].map(t => ({ stringValue: t })) } }]
  } }));
  if (writes.length) await fetch(`${FS}:commit`, { method: 'POST', headers: H, body: JSON.stringify({ writes }) });

  last = started.toISOString();
  if (sent > 0 || Date.now() - lastSaved > 60000) await persist(at, last);
  return sent;
}

const end = Date.now() + RUN_SECONDS * 1000;
let total = 0;
while (Date.now() < end) {
  try { total += await poll(); }
  catch (e) { console.log('エラー（次の確認でやり直します）:', e.message); }
  await sleep(INTERVAL_MS);
}
try { if (last) await persist(await accessToken(), last); } catch (e) {}
console.log(`終了: この回で ${total} 件の通知を送りました`);
