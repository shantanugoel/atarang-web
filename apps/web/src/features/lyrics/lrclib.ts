interface LrclibResult {
  id:number;
  trackName:string;
  artistName:string;
  duration:number;
  syncedLyrics:string|null;
}

export interface LyricsSearch {
  trackName:string;
  artistName?:string;
  durationSeconds?:number;
  signal?:AbortSignal;
}

const normalized=(value:string)=>value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

export async function findSyncedLyrics(search:LyricsSearch):Promise<string|null>{
  const query=new URLSearchParams({track_name:search.trackName});
  if(search.artistName&&search.artistName!=="Local import")query.set("artist_name",search.artistName);
  if(search.durationSeconds)query.set("duration",String(Math.round(search.durationSeconds)));
  const response=await fetch(`https://lrclib.net/api/search?${query}`,{headers:{Accept:"application/json"},...(search.signal?{signal:search.signal}:{})});
  if(response.status===429)throw new Error("lyrics_rate_limited");
  if(!response.ok)throw new Error("lyrics_lookup_failed");
  const results=await response.json() as LrclibResult[];
  const title=normalized(search.trackName),artist=normalized(search.artistName??"");
  const ranked=results.filter(item=>item.syncedLyrics?.trim()).sort((left,right)=>{
    const score=(item:LrclibResult)=>(normalized(item.trackName)===title?4:0)+(artist&&normalized(item.artistName)===artist?2:0)+(search.durationSeconds!==undefined&&Math.abs(item.duration-search.durationSeconds)<=3?1:0);
    return score(right)-score(left);
  });
  return ranked[0]?.syncedLyrics?.trim()??null;
}
