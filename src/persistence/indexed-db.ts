import { validateTeachingState } from '../modules/teaching/transfer';
import { deleteDB, openDB } from 'idb';
import type { WorkspaceRepository } from '../ports';
import { snapshotSchema } from './schema';
import { fixtureVersion } from '../fixtures/s01';
import { upgradeTeachingSnapshot } from '../modules/teaching/content';

export const teachingDatabaseName='riverline-demo-t1';
const legacyDatabaseName='riverline-demo';
async function openWorkspace(name:string){return openDB(name,1,{upgrade(db){db.createObjectStore('workspace');}});}
async function legacyRaw(){
  if(indexedDB.databases){const databases=await indexedDB.databases();if(!databases.some(v=>v.name===legacyDatabaseName))return undefined;}
  const db=await openWorkspace(legacyDatabaseName);try{return await db.get('workspace','current');}finally{db.close();}
}
export const indexedDbRepository:WorkspaceRepository={
  async readRaw(){const db=await openWorkspace(teachingDatabaseName);let raw:unknown;try{raw=await db.get('workspace','current');}finally{db.close();}return raw===undefined?legacyRaw():raw;},
  async load(){
    const db=await openWorkspace(teachingDatabaseName);
    try{
      const raw:unknown=await db.get('workspace','current'),migrated=await db.get('workspace','migration');
      if(raw!==undefined){const parsed=snapshotSchema.parse(raw);if(parsed.schemaVersion!==2||!parsed.teaching)throw Error('新工作区版本不完整，原件已保留。');const errors=validateTeachingState(parsed.teaching);if(errors.length)throw Error(errors[0]);return parsed;}
      if(migrated!==undefined)throw Error('新库缺少 current，不能静默回退旧记录。');
      const original=await legacyRaw();if(original===undefined)return null;
      const old=snapshotSchema.parse(original);if(old.fixtureVersion!==fixtureVersion)throw Error('旧 fixture 版本不匹配，原件未修改。');
      const next=upgradeTeachingSnapshot(old),valid=snapshotSchema.parse(next);
      const tx=db.transaction('workspace','readwrite');await tx.store.put(valid,'current');await tx.store.put(next.teaching!.migration,'migration');await tx.store.put(original,'legacy-original');await tx.done;
      return valid;
    }finally{db.close();}
  },
  async save(snapshot){const valid=snapshotSchema.parse(snapshot);if(valid.schemaVersion!==2||!valid.teaching)throw Error('只能保存完整 T1 schema2 工作区。');const db=await openWorkspace(teachingDatabaseName);try{const tx=db.transaction('workspace','readwrite');await tx.store.put(valid,'current');await tx.done;}finally{db.close();}},
  async reset(){await deleteDB(teachingDatabaseName);await deleteDB(legacyDatabaseName);},
};
