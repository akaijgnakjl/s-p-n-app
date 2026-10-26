import {getContext,getSlotState,USE_CASES,validateProject} from './model.js';
import {composePhoto as composeDefault} from './images.js';
import {Zip,ZipPassThrough} from 'fflate';
import {yieldTask} from './task-yield.js';

export function safePhotoName(value){
  const name=String(value).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'写真';
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)?`_${name}`:name;
}
const abort=signal=>{if(signal?.aborted)throw new DOMException('写真出力を取り消しました。保存済みのファイルは出力先に残ります。','AbortError');};
export function photoExportPlan(project,recordIds){
  validateProject(project);
  const wanted=new Set(recordIds),found=new Set(),items=[];
  for(const target of project.targets)for(const record of target.records){
    if(!wanted.has(record.id))continue;found.add(record.id);
    for(const slot of USE_CASES[target.useCase].slots){const state=getSlotState(project,record.id,slot);if(state.status==='taken')items.push({photo:structuredClone(state.photo),base:safePhotoName(`${target.name}_${record.category}_${slot}`)});}
  }
  if(found.size!==wanted.size)throw new Error('出力対象の記録が見つかりません。');
  if(!items.length)throw new Error('選択範囲に採用写真がありません。');
  return items;
}

/** One composed image at a time; existing directory files are never overwritten. */
export async function exportPhotos(project,originals,recordIds,{directory=null,signal,onProgress,compose=composeDefault}={}){
  const plan=photoExportPlan(project,recordIds),sources=new Map(originals),used=new Set(),chunks=[];
  let currentInput,zipError,finished=false,completed=0;
  const zip=directory?null:new Zip((error,chunk,final)=>{if(error)zipError=error;else chunks.push(currentInput?.bytes===chunk?currentInput.blob:chunk);if(final)finished=true;});
  try{
    for(const item of plan){
      abort(signal);
      const original=sources.get(item.photo.id);
      if(!(original instanceof Blob)||original.size!==item.photo.size||original.type!==item.photo.type)throw new Error('出力する元写真が見つかりません。');
      const blob=await compose(original,item.photo,{signal});abort(signal);
      const extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[blob.type];
      if(!extension)throw new Error('写真の形式を確認してください。');
      let filename,index=1;
      for(;;index++){
        filename=`${item.base}${index===1?'':`_${index}`}.${extension}`;
        if(used.has(filename.toLocaleLowerCase()))continue;
        if(directory){try{await directory.getFileHandle(filename);continue;}catch(error){if(error.name!=='NotFoundError')throw error;}}
        break;
      }
      used.add(filename.toLocaleLowerCase());abort(signal);
      if(directory){
        const handle=await directory.getFileHandle(filename,{create:true}),writer=await handle.createWritable();
        try{await writer.write(blob);abort(signal);await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}
      }else{
        const entry=new ZipPassThrough(filename);zip.add(entry);
        for(let at=0;at<blob.size;at+=65536){abort(signal);const slice=blob.slice(at,at+65536);currentInput={blob:slice,bytes:new Uint8Array(await slice.arrayBuffer())};entry.push(currentInput.bytes,at+65536>=blob.size);currentInput=null;if(zipError)throw zipError;await yieldTask();}
      }
      completed++;onProgress?.({phase:'photos',completed,total:plan.length});await yieldTask();
    }
    if(zip){zip.end();if(zipError)throw zipError;if(!finished)throw new Error('写真ZIPを作成できませんでした。');}
    return {count:completed,blob:zip?new Blob(chunks,{type:'application/zip'}):null};
  }catch(error){const failure=new Error(`${error.message}（保存完了 ${completed}/${plan.length}枚）`,{cause:error});failure.name=error.name;throw failure;}
  finally{zip?.terminate();chunks.length=0;sources.clear();currentInput=null;}
}
