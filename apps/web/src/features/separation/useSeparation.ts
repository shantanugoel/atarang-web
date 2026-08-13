import {useEffect,useState} from "react";
import type {OriginalRecord,SeparationRecord} from "../../storage/database";
import {getSeparationForOriginal,subscribeLibrary} from "../../storage/repositories";

// Every library write re-reads this record, and the read builds a new object
// each time. Handing back a new object for an unchanged separation tears down
// and rebuilds the four-stem engine underneath whoever is using it — which is
// why the first Play after a separation finished did nothing: the click reached
// an engine that had already been disposed.
const same=(left:SeparationRecord|null|undefined,right:SeparationRecord|null|undefined)=>Boolean(left&&right&&left.id===right.id&&left.originalId===right.originalId&&left.updatedAt===right.updatedAt);

export function useSeparation(original?:OriginalRecord){const[record,setRecord]=useState<SeparationRecord|null|undefined>(original?undefined:null);useEffect(()=>{let active=true;const refresh=()=>{if(!original){setRecord(null);return}void getSeparationForOriginal(original.id,original.contentSha256).then(value=>{if(active)setRecord(current=>same(current,value)?current:value??null)})};setRecord(original?undefined:null);refresh();const unsubscribe=subscribeLibrary(refresh);return()=>{active=false;unsubscribe()}},[original]);return record}
