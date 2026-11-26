// All OCR assets are bundled locally. Images and recognized values never leave the device.
export const TS_SCREENSHOT_REGIONS=Object.freeze({
  x:Object.freeze([.035,.303,.245,.045]),
  y:Object.freeze([.035,.532,.245,.045]),
  station:Object.freeze([.18,.745,.3,.042]),
});
const abort=signal=>{if(signal?.aborted)throw new DOMException('読み取りを取り消しました。','AbortError');};
export function parseTSNumber(text){const value=String(text??'').normalize('NFKC').replace(/\s/g,'');return /^-?\d{1,3}\.\d{3}$/.test(value)&&Math.abs(Number(value))<=10?value:null;}
export function parseTSStation(text){const value=String(text??'').normalize('NFKC').toUpperCase().replace(/\s/g,'');const match=/^(?:SP)?(\d{1,6}(?:\.\d{1,3})?)\(?([LR])\)?$/.exec(value);return match?{station:match[1],side:match[2]}:null;}
export function agreeTSReadings(first,second,parser){const a=parser(first.text),b=parser(second.text);return a!==null&&JSON.stringify(a)===JSON.stringify(b)&&Math.min(first.confidence??0,second.confidence??0)>=50?a:null;}
/**
 * 前処理を変えた複数回の読取りから値を決める。書式どおりに読めた値だけを数え、
 * 2回以上同じ値になり、他の値と票が並ばず、信頼度の合計が十分（または3回とも同じ値）な時だけ採用する（推測では埋めない）。
 */
export function voteTSReadings(readings,parser,{minVotes=2,minConfidence=100}={}){
  const votes=new Map();
  for(const reading of readings){const value=parser(reading.text);if(value===null)continue;const key=JSON.stringify(value),entry=votes.get(key)||{value,count:0,confidence:0};entry.count++;entry.confidence+=Math.max(0,reading.confidence??0);votes.set(key,entry);}
  const ranked=[...votes.values()].sort((a,b)=>b.count-a.count||b.confidence-a.confidence);
  const [best,second]=ranked;
  // 3種類すべてで同じ値に読めた時は、信頼度の数値が低くても採用する（OCRが同じ文字に信頼度0を返すことがあるため）。
  if(!best||best.count<minVotes||(best.confidence<minConfidence&&best.count<3)||(second&&second.count===best.count))return null;
  return best.value;
}
/** 読めた候補（票の多い順）。確定できない時に、管理名との照合で使う。 */
export function tsCandidates(readings,parser){const counts=new Map();for(const reading of readings){const value=parser(reading.text);if(value===null)continue;const key=JSON.stringify(value);counts.set(key,(counts.get(key)||0)+1);}return [...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([key])=>JSON.parse(key));}
export function classifyTSSideImage({data,width,height}){let left=width,right=0,top=height,bottom=0;const ink=(x,y)=>{const i=(y*width+x)*4;return data[i]<100&&data[i+1]<100&&data[i+2]<100;};for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(ink(x,y)){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}const w=right-left+1,h=bottom-top+1;if(h<12||w/h<.25||w/h>1)return null;const density=(x0,y0,x1,y1)=>{let pixels=0,total=0;for(let y=top+Math.floor(h*y0);y<top+Math.floor(h*y1);y++)for(let x=left+Math.floor(w*x0);x<left+Math.floor(w*x1);x++){total++;if(ink(x,y))pixels++;}return pixels/Math.max(1,total);};const upper=density(.5,.08,1,.5),lower=density(.5,.82,1,1),stem=density(0,0,.25,.82);if(stem<.2)return null;if(upper<.025&&lower>.18)return 'L';if(upper>.12)return 'R';return null;}
function splitStation(canvas){const ctx=canvas.getContext('2d'),{data}=ctx.getImageData(0,0,canvas.width,canvas.height),runs=[];let start=-1;for(let x=0;x<=canvas.width;x++){let ink=false;if(x<canvas.width)for(let y=0;y<canvas.height;y++){const at=(y*canvas.width+x)*4;if(data[at]<100&&data[at+1]<100&&data[at+2]<100){ink=true;break;}}if(ink&&start<0)start=x;else if(!ink&&start>=0){runs.push([start,x]);start=-1;}}if(runs.length<4)return null;const last=runs.at(-1),copy=(left,width)=>{const out=document.createElement('canvas');out.width=width+32;out.height=canvas.height;const c=out.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,out.width,out.height);c.drawImage(canvas,left,0,width,canvas.height,16,0,width,canvas.height);return out;};return [copy(0,last[0]-2),copy(last[0]-2,last[1]-last[0]+4)];}
// 前処理の種類：そのまま／二値化（しきい値170）／拡大して二値化（しきい値128）。
const VARIANTS=Object.freeze([{width:660,threshold:null},{width:660,threshold:170},{width:900,threshold:128}]);
function regionCanvas(image,region,{width=660,threshold=null}={}){const [x,y,w,h]=region,canvas=document.createElement('canvas'),scale=width/(image.width*w);canvas.width=width+32;canvas.height=Math.round(image.height*h*scale)+32;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,image.width*x,image.height*y,image.width*w,image.height*h,16,16,width,canvas.height-32);if(threshold!==null){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<pixels.data.length;i+=4){const v=(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114)>threshold?255:0;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;}ctx.putImageData(pixels,0,0);}const ink=ctx.getImageData(0,0,canvas.width,canvas.height);let left=canvas.width,right=0,top=canvas.height,bottom=0;for(let row=0;row<canvas.height;row++)for(let col=0;col<canvas.width;col++){const at=(row*canvas.width+col)*4;if(ink.data[at]<100&&ink.data[at+1]<100&&ink.data[at+2]<100){left=Math.min(left,col);right=Math.max(right,col);top=Math.min(top,row);bottom=Math.max(bottom,row);}}if(right>left&&bottom>top){const trimmed=document.createElement('canvas');trimmed.width=right-left+33;trimmed.height=bottom-top+33;const t=trimmed.getContext('2d');t.fillStyle='#fff';t.fillRect(0,0,trimmed.width,trimmed.height);t.drawImage(canvas,left,top,right-left+1,bottom-top+1,16,16,right-left+1,bottom-top+1);canvas.width=canvas.height=1;return trimmed;}return canvas;}
const numberPart=value=>/^\d{1,6}(?:\.\d{1,3})?$/.test(String(value).trim())?String(value).trim():null;
/** 確認用に、計測箇所の欄だけを切り出した画像（PNGのdata URL）を作る。 */
export async function tsStationPreview(blob){const image=await createImageBitmap(blob);try{const [x,y,w,h]=TS_SCREENSHOT_REGIONS.station,canvas=document.createElement('canvas'),width=Math.round(image.width*(w+.03)),height=Math.round(image.height*(h+.01));canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,image.width*(x-.008),image.height*(y-.005),width,height,0,0,width,height);const url=canvas.toDataURL('image/png');canvas.width=canvas.height=1;return url;}finally{image.close();}}

/**
 * OCRの作業領域を1つ用意して、複数のスクリーンショットを続けて読む（まとめて取り込む時に毎回の起動を省く）。
 * 使い終わったら close() を呼ぶ。
 */
export async function createTSReader({signal}={}){
  abort(signal);
  const {default:Tesseract}=await import('./vendor/ocr/tesseract.esm.min.js');abort(signal);
  const worker=await Tesseract.createWorker('eng',1,{workerPath:new URL('./vendor/ocr/worker.min.js',import.meta.url).href,corePath:new URL('./vendor/ocr/',import.meta.url).href,langPath:new URL('./vendor/ocr/',import.meta.url).href,workerBlobURL:false,cacheMethod:'none',gzip:true,logger:()=>{}});
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;await worker.terminate();};
  async function read(blob,{signal,onProgress=()=>{}}={}){
    if(closed)throw new Error('読み取りは終了しています。');
    abort(signal);let image,rejectStop,timer;
    const stopped=new Promise((_,reject)=>{rejectStop=reject;});stopped.catch(()=>{});
    const stop=()=>rejectStop(new DOMException('読み取りを取り消しました。','AbortError'));signal?.addEventListener('abort',stop,{once:true});
    const recognize=async canvas=>{try{const result=await Promise.race([worker.recognize(canvas),stopped]);return {text:result.data.text,confidence:result.data.confidence};}finally{canvas.width=canvas.height=1;}};
    try{
      image=await createImageBitmap(blob);abort(signal);
      if(image.height<600||image.width/image.height<.38||image.width/image.height>.58)return {complete:false,values:{},missing:['X','Y','計測箇所'],candidates:{},message:'縦向きのスクリーンショット全体を選んでください。'};
      timer=setTimeout(()=>rejectStop(new Error('時間がかかるため読み取りを中止しました。画像を保存して手入力できます。')),90000);
      const values={},missing=[],readings={},candidates={};
      for(const [key,region] of Object.entries(TS_SCREENSHOT_REGIONS)){
        abort(signal);onProgress(`${key==='station'?'計測箇所':key.toUpperCase()}を読み取っています…`);
        const station=key==='station',parser=station?parseTSStation:parseTSNumber,results=[];
        await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:station?'0123456789.SPLR()':'0123456789.-',user_defined_dpi:'300'});
        // まず2種類で読み、両方が同じ値で信頼度が高ければ確定。そうでなければ3種類目も読んで多数決にする。
        for(const variant of VARIANTS.slice(0,2)){results.push(await recognize(regionCanvas(image,region,variant)));abort(signal);}
        let parsed=agreeTSReadings(results[0],results[1],parser);
        if(parsed===null){results.push(await recognize(regionCanvas(image,region,VARIANTS[2])));abort(signal);parsed=voteTSReadings(results,parser);}
        readings[key]=results;
        if(station&&parsed===null){
          // 計測箇所は「数字」と「L/R」を分けて読む。L/Rは文字の形で判定し、数字は3種類の前処理で多数決にする。
          const digits=[],sides=[];
          for(const variant of VARIANTS){const canvas=regionCanvas(image,region,variant),parts=splitStation(canvas);try{if(!parts)continue;const [number,side]=parts;const kind=classifyTSSideImage(side.getContext('2d').getImageData(0,0,side.width,side.height));sides.push({text:kind||'',confidence:kind?90:0});await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.'});digits.push(await recognize(number));side.width=side.height=1;}finally{canvas.width=canvas.height=1;}abort(signal);}
          readings.stationParts={digits,sides};
          const side=voteTSReadings(sides,value=>/^[LR]$/.test(value.trim())?value.trim():null,{minConfidence:150}),number=voteTSReadings(digits,numberPart,{minConfidence:120});
          if(number!==null&&side!==null)parsed={station:number,side};
          const sideGuess=side??tsCandidates(sides,value=>/^[LR]$/.test(value.trim())?value.trim():null)[0];
          candidates.station=[...tsCandidates(results,parser),...(sideGuess?tsCandidates(digits,numberPart).map(number=>({station:number,side:sideGuess})):[])].filter((value,index,list)=>list.findIndex(item=>item.station===value.station&&item.side===value.side)===index);
        }
        if(parsed===null)missing.push(station?'計測箇所':key.toUpperCase());else values[key]=parsed;
      }
      return {complete:!missing.length,values,missing,readings,candidates};
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);image?.close();}
  }
  return {read,close};
}

export async function readTSScreenshot(blob,{signal,onProgress=()=>{}}={}){
  abort(signal);let reader,rejectStop;
  const stopped=new Promise((_,reject)=>{rejectStop=reject;});stopped.catch(()=>{});
  const stop=()=>{void reader?.close();rejectStop(new DOMException('読み取りを取り消しました。','AbortError'));};
  signal?.addEventListener('abort',stop,{once:true});
  try{
    onProgress('スクリーンショットを読み取っています…');
    reader=await Promise.race([createTSReader({signal}),stopped]);abort(signal);
    return await Promise.race([reader.read(blob,{signal,onProgress}),stopped]);
  }finally{signal?.removeEventListener('abort',stop);await reader?.close();}
}
