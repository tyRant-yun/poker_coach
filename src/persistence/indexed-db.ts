import { openDB } from 'idb';
import type { WorkspaceRepository } from '../ports';
import { snapshotSchema } from './schema';
import { fixtureVersion } from '../fixtures/s01';

export const indexedDbRepository: WorkspaceRepository = {
  async readRaw() {
    const db = await openDB('riverline-demo',1,{upgrade(db){db.createObjectStore('workspace');}});
    try{return await db.get('workspace','current');}finally{db.close();}
  },
  async load() {
    const db = await openDB('riverline-demo', 1, { upgrade(db) { db.createObjectStore('workspace'); } });
    try {
      const raw: unknown = await db.get('workspace', 'current');
      if (raw === undefined) return null;
      const snapshot = snapshotSchema.parse(raw);
      if (snapshot.fixtureVersion !== fixtureVersion) throw new Error('演示数据版本不兼容，原记录已保留。');
      return snapshot;
    } finally { db.close(); }
  },
  async save(snapshot) {
    const valid = snapshotSchema.parse(snapshot);
    const db = await openDB('riverline-demo', 1, { upgrade(db) { db.createObjectStore('workspace'); } });
    try {
      const tx = db.transaction('workspace', 'readwrite');
      await tx.store.put(valid, 'current');
      await tx.done;
    } finally { db.close(); }
  },
};
