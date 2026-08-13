import{useEffect,useState}from"react";
import{assertChordAnalysis,type ChordAnalysisV1}from"@atarang/contracts";
import{getChordAnalysis,subscribeLibrary}from"../../storage/repositories";

export function useChordAnalysis(originalId?:string){const[value,setValue]=useState<ChordAnalysisV1|null|undefined>(originalId?undefined:null);useEffect(()=>{let active=true;const refresh=()=>{if(!originalId){setValue(null);return}void getChordAnalysis(originalId).then(record=>{if(!active)return;if(!record){setValue(null);return}try{assertChordAnalysis(record.document);setValue(record.document)}catch{setValue(null)}},()=>{if(active)setValue(null)})};setValue(originalId?undefined:null);refresh();const unsubscribe=subscribeLibrary(refresh);return()=>{active=false;unsubscribe()}},[originalId]);return value}
