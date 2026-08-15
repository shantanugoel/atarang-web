export interface LrclibResult {
  id:number;
  trackName:string;
  artistName:string;
  albumName?:string|null;
  duration:number;
  syncedLyrics:string|null;
  plainLyrics?:string|null;
}

export interface LyricsSearch {
  trackName:string;
  artistName?:string;
  durationSeconds?:number;
  signal?:AbortSignal;
}

const normalized=(value:string)=>value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
// Enhanced LRC: inline word tags, which the sing-along view highlights a word at
// a time and the chord placement uses instead of guessing from characters.
// LRCLIB carries them for part of its catalogue, so this is a tiebreaker and not
// a filter — a word-timed copy of the wrong song is still the wrong song.
const ENHANCED=/<\d{1,3}:\d{2}(?:\.\d{1,3})?>/;

export async function searchLyricsCandidates(search:LyricsSearch&{query?:string}):Promise<LrclibResult[]>{
  const query=search.query?.trim()?new URLSearchParams({q:search.query.trim()}):new URLSearchParams({track_name:search.trackName});
  if(search.artistName&&search.artistName!=="Local import")query.set("artist_name",search.artistName);
  if(search.durationSeconds)query.set("duration",String(Math.round(search.durationSeconds)));
  const response=await fetch(`https://lrclib.net/api/search?${query}`,{headers:{Accept:"application/json","Lrclib-Client":"Atarang Web/1.0 (https://github.com/shantanugoel/atarang)"},...(search.signal?{signal:search.signal}:{})});
  if(response.status===429)throw new Error("lyrics_rate_limited");
  if(!response.ok)throw new Error("lyrics_lookup_failed");
  const results=await response.json() as LrclibResult[];
  const title=normalized(search.trackName),artist=normalized(search.artistName??"");
  return results.filter(item=>item.syncedLyrics?.trim()||item.plainLyrics?.trim()).sort((left,right)=>{
    const score=(item:LrclibResult)=>(normalized(item.trackName)===title?4:0)+(artist&&normalized(item.artistName)===artist?2:0)+(search.durationSeconds!==undefined&&Math.abs(item.duration-search.durationSeconds)<=3?1:0)+(ENHANCED.test(item.syncedLyrics??"")?.5:0);
    return score(right)-score(left);
  });
}

export async function findSyncedLyrics(search:LyricsSearch):Promise<string|null>{
  const ranked=await searchLyricsCandidates(search);
  return ranked.find(item=>item.syncedLyrics?.trim())?.syncedLyrics?.trim()??null;
}
