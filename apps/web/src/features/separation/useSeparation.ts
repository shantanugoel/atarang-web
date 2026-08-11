import {useEffect,useState} from "react";
import type {OriginalRecord,SeparationRecord} from "../../storage/database";
import {getSeparationForOriginal,subscribeLibrary} from "../../storage/repositories";

export function useSeparation(original?:OriginalRecord){const[record,setRecord]=useState<SeparationRecord|null|undefined>(original?undefined:null);useEffect(()=>{let active=true;const refresh=()=>{if(!original){setRecord(null);return}void getSeparationForOriginal(original.id,original.contentSha256).then(value=>{if(active)setRecord(value??null)})};setRecord(original?undefined:null);refresh();const unsubscribe=subscribeLibrary(refresh);return()=>{active=false;unsubscribe()}},[original]);return record}
