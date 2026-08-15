import {uuidV7} from "./ids";

const channel=typeof BroadcastChannel==="undefined"?null:new BroadcastChannel("atarang-mutation-leases");

// The tail of this tab's own queue, per song.
//
// The lease underneath refuses rather than waits — `ifAvailable` for the lock
// path, an unexpired claim for the fallback — and that refusal is reported as
// "already being processed in another tab". True of a real second tab, and a
// lie in the case that actually happens: arriving in the Studio starts waveform
// analysis, which holds the lease, while the separation sheet opens and invites
// the reader to press Start. Same-tab callers wait here for their turn instead,
// so by the time one of them asks for the lease the only thing that can still
// be holding it is a different tab, and the message is true whenever it is
// shown. Both paths sit behind this queue, so a browser without
// `navigator.locks` behaves the same way.
const queued=new Map<string,Promise<void>>();

export function withSongMutationLease<T>(songId:string,task:()=>Promise<T>):Promise<T>{
  const previous=queued.get(songId);
  const run=previous?previous.then(()=>claimAndRun(songId,task)):claimAndRun(songId,task);
  // Swallowed on purpose: the next caller in line is waiting for the turn to
  // end, not for it to succeed, and a failed turn leaves nothing behind — the
  // lease wraps its task from the outside, so nothing has been written.
  const tail=run.then(()=>undefined,()=>undefined);
  queued.set(songId,tail);
  void tail.then(()=>{if(queued.get(songId)===tail)queued.delete(songId)});
  return run;
}

async function claimAndRun<T>(songId:string,task:()=>Promise<T>):Promise<T>{const name=`atarang:song:${songId}`;if(navigator.locks)return navigator.locks.request(name,{mode:"exclusive",ifAvailable:true},async lock=>{if(!lock)throw new Error("song_busy_in_another_tab");channel?.postMessage({type:"claimed",songId});try{return await task()}finally{channel?.postMessage({type:"released",songId})}});const storageKey=`${name}:fallback`,token=uuidV7(),claim=()=>{const now=Date.now();try{const current=JSON.parse(localStorage.getItem(storageKey)??"null")as{token:string;expiresAt:number}|null;if(current&&current.expiresAt>now)throw new Error("song_busy_in_another_tab")}catch(error){if(error instanceof Error&&error.message==="song_busy_in_another_tab")throw error}localStorage.setItem(storageKey,JSON.stringify({token,expiresAt:now+15_000}));const stored=JSON.parse(localStorage.getItem(storageKey)??"null")as{token?:string};if(stored.token!==token)throw new Error("song_busy_in_another_tab")};claim();const heartbeat=window.setInterval(()=>{try{const stored=JSON.parse(localStorage.getItem(storageKey)??"null")as{token?:string};if(stored.token===token)localStorage.setItem(storageKey,JSON.stringify({token,expiresAt:Date.now()+15_000}))}catch{/* lease expires safely */}},5_000);channel?.postMessage({type:"claimed",songId});try{return await task()}finally{window.clearInterval(heartbeat);try{const stored=JSON.parse(localStorage.getItem(storageKey)??"null")as{token?:string};if(stored.token===token)localStorage.removeItem(storageKey)}catch{/* expiry remains the fallback */}channel?.postMessage({type:"released",songId})}}
