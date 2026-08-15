import {useCallback,useEffect,useRef,useState} from "react";
import {assertLyricsDocument,type LyricsDocumentV1} from "@atarang/contracts";
import {getLyrics,putLyrics,subscribeLibrary} from "../../storage/repositories";

export function useLyrics(originalId?:string){
  const[document,setDocument]=useState<LyricsDocumentV1|null|undefined>(originalId?undefined:null);const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const latest=useRef<LyricsDocumentV1|null>(null);const createdAt=useRef(new Date().toISOString());
  const flush=useCallback(()=>{if(timer.current)clearTimeout(timer.current);const value=latest.current;if(!value)return;void putLyrics({id:value.originalId,originalId:value.originalId,revision:value.revision,document:value,schemaVersion:1,createdAt:createdAt.current,updatedAt:value.updatedAt})},[]);
  useEffect(()=>{let active=true;if(!originalId){setDocument(null);latest.current=null;return}const refresh=()=>{void getLyrics(originalId).then(record=>{if(!active)return;let value:LyricsDocumentV1|null=null;try{if(record){assertLyricsDocument(record.document);value=record.document;createdAt.current=record.createdAt}}catch{/* Damaged generated lyrics read as missing. */}if(latest.current&&(!value||value.revision<=latest.current.revision))return;/* A pending local edit outranks the stored revision. */latest.current=value;setDocument(value)})};setDocument(undefined);refresh();const unsubscribe=subscribeLibrary(refresh);const hide=()=>flush();window.addEventListener("pagehide",hide);return()=>{active=false;flush();unsubscribe();window.removeEventListener("pagehide",hide)}},[flush,originalId]);
  const save=useCallback((next:LyricsDocumentV1)=>{const value={...next,revision:(latest.current?.revision??next.revision)+1,updatedAt:new Date().toISOString()};latest.current=value;setDocument(value);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(flush,350)},[flush]);
  return{document,save,flush};
}
