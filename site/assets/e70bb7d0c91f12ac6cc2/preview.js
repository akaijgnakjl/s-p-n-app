/** A read-only viewer. Image URLs and document zoom never enter work metadata. */
export function fitScale(width, height, availableWidth, availableHeight, { document = false } = {}) {
  if (![width,height,availableWidth,availableHeight].every(value=>Number.isFinite(value)&&value>0)) return 1;
  const fit = document ? availableWidth / width : Math.min(availableWidth / width,availableHeight / height);
  return Math.min(1,Math.max(0.01,fit));
}
export function boundedZoom(value) { return Math.min(3,Math.max(.25,Number.isFinite(value)?value:1)); }

export function createPreviewViewer({onDocumentMove=()=>{}}={}) {
  const get=id=>document.getElementById(id);
  const dialog=get('previewDialog'),viewport=get('previewViewport'),stage=get('previewStage');
  let revision=0,kind='',image=null,url=null,documentFrame=null,placeholder=null,frameParent=null,frameNext=null,frameStyle=null;
  let scale=1,naturalWidth=0,naturalHeight=0,trigger=null,oldOverflow='',frameScroll={x:0,y:0};
  let frameLoad=null,cancelImageLoad=null;
  const imageControls=['zoomOut','zoomIn','zoomFit','zoomActual'];

  function controls(enabled) {
    for(const id of imageControls){get(id).disabled=!enabled;get(id).dataset.unavailable=String(!enabled);}
    get('zoomLabel').textContent=enabled?`${Math.round(scale*100)}%`:'準備中';
    if(enabled){get('zoomOut').disabled=scale<=.25;get('zoomOut').dataset.unavailable=String(scale<=.25);get('zoomIn').disabled=scale>=3;get('zoomIn').dataset.unavailable=String(scale>=3);}
  }
  function dimensions() {
    const style=getComputedStyle(viewport);
    return {width:Math.max(1,viewport.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)),height:Math.max(1,viewport.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))};
  }
  function applyScale(next,{reset=false}={}) {
    const before=scale;scale=next;
    if(image)image.style.width=`${Math.max(1,Math.round(naturalWidth*scale))}px`;
    if(documentFrame?.contentDocument?.body) {
      // Screen-only style on the live preview. Download/print still uses the unchanged prepared HTML.
      documentFrame.contentDocument.body.style.zoom=String(scale);
    }
    if(reset){viewport.scrollTop=0;viewport.scrollLeft=0;if(documentFrame?.contentWindow)documentFrame.contentWindow.scrollTo(0,0);}
    else if(image&&before>0){viewport.scrollLeft=(viewport.scrollLeft+viewport.clientWidth/2)*scale/before-viewport.clientWidth/2;viewport.scrollTop=(viewport.scrollTop+viewport.clientHeight/2)*scale/before-viewport.clientHeight/2;}
    controls(true);
  }
  function fit() {
    const area=dimensions();
    if(image)applyScale(fitScale(naturalWidth,naturalHeight,area.width,area.height),{reset:true});
    else if(documentFrame?.contentDocument) {
      const page=documentFrame.contentDocument.querySelector('.page');
      const width=page?.offsetWidth||794;
      applyScale(fitScale(width,1,Math.max(1,documentFrame.clientWidth-32),1,{document:true}),{reset:true});
    }
  }
  function showMessage(message,error=false) {
    stage.replaceChildren();const p=document.createElement('p');p.className='preview-message';p.textContent=message;if(error)p.setAttribute('role','alert');stage.append(p);controls(false);if(error)get('zoomLabel').textContent='表示できません';
  }
  function cleanup() {
    ++revision;
    if(cancelImageLoad){cancelImageLoad();cancelImageLoad=null;}
    if(documentFrame){
      const frame=documentFrame;
      if(frameLoad)frame.removeEventListener('load',frameLoad);
      try { frame.contentDocument.body.style.removeProperty('zoom'); } catch {}
      frame.classList.remove('preview-document');
      if(frameStyle===null)frame.removeAttribute('style');else frame.setAttribute('style',frameStyle);
      const restoreScroll=()=>{try{frame.contentWindow.scrollTo(frameScroll.x,frameScroll.y);}catch{}};
      frame.addEventListener('load',restoreScroll,{once:true});
      if(placeholder?.isConnected)placeholder.replaceWith(frame);
      else if(frameParent?.isConnected)frameParent.insertBefore(frame,frameNext?.parentNode===frameParent?frameNext:null);
      documentFrame=null;placeholder=null;frameParent=null;frameNext=null;frameLoad=null;
      onDocumentMove(frame);restoreScroll();
    }
    stage.replaceChildren();image=null;kind='';
    if(url){URL.revokeObjectURL(url);url=null;}
  }
  function close() {
    const restore=trigger;trigger=null;
    if(dialog.open)dialog.close();
    cleanup();document.body.style.overflow=oldOverflow;
    if(restore?.isConnected)restore.focus({preventScroll:true});
  }
  function begin(type,title,caption,element) {
    if(dialog.open)close();else cleanup();
    kind=type;trigger=element||document.activeElement;oldOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';dialog.classList.toggle('is-document',type==='document');
    get('previewTitle').textContent=title;get('previewCaption').textContent=caption||'';
    scale=1;controls(false);if(!dialog.open)dialog.showModal();
    viewport.scrollTop=0;viewport.scrollLeft=0;return revision;
  }
  async function showImage({blob,loadBlob,title='画像プレビュー',caption='',trigger:element}={}) {
    const token=begin('image',title,caption,element);showMessage('画像を準備しています…');
    try {
      const source=loadBlob?await loadBlob():blob;
      if(token!==revision||!dialog.open)return;
      if(!(source instanceof Blob)||!source.size)throw new Error('表示する画像がありません。');
      url=URL.createObjectURL(source);image=document.createElement('img');image.className='preview-image';image.alt=title;image.draggable=false;
      const ready=new Promise((resolve,reject)=>{cancelImageLoad=()=>reject(new DOMException('Closed','AbortError'));image.onload=resolve;image.onerror=()=>reject(new Error('画像を表示できません。原本を確認してください。'));});
      stage.replaceChildren(image);image.src=url;await ready;cancelImageLoad=null;
      if(token!==revision||!dialog.open)return;
      naturalWidth=image.naturalWidth;naturalHeight=image.naturalHeight;fit();get('closePreview').focus({preventScroll:true});
    } catch(error) {
      if(token!==revision||!dialog.open)return;
      if(url){URL.revokeObjectURL(url);url=null;}image=null;showMessage(error.message||'画像を表示できません。',true);
    }
  }
  function showDocument({frame,title='調書・写真帳プレビュー',caption='',trigger:element}={}) {
    if(!frame?.isConnected)throw new Error('先に出力プレビューを作成してください。');
    const parent=frame.parentNode,next=frame.nextSibling,style=frame.getAttribute('style');
    const position={x:frame.contentWindow?.scrollX||0,y:frame.contentWindow?.scrollY||0};
    const token=begin('document',title,caption,element);
    documentFrame=frame;frameParent=parent;frameNext=next;frameStyle=style;frameScroll=position;
    placeholder=document.createElement('div');placeholder.className='output-preview-placeholder';placeholder.style.height=`${frame.getBoundingClientRect().height}px`;placeholder.textContent='全画面で確認中です。閉じるとこの位置へ戻ります。';
    frame.before(placeholder);frame.classList.add('preview-document');frame.style.removeProperty('height');
    frameLoad=async()=>{
      const doc=frame.contentDocument;
      try{
        if(!frame.contentWindow.outputReady)return;
        await frame.contentWindow.outputReady;
        if(token!==revision||!dialog.open||documentFrame!==frame||frame.contentDocument!==doc)return;
        if(!doc.documentElement.dataset.previewKeyboard){
          doc.documentElement.dataset.previewKeyboard='true';
          doc.addEventListener('keydown',event=>{
            if(!dialog.open||documentFrame!==frame||event.ctrlKey||event.metaKey)return;
            if(event.key==='Escape'){event.preventDefault();close();}
            if(['+','='].includes(event.key)){event.preventDefault();applyScale(boundedZoom(scale+.25));}
            if(event.key==='-'){event.preventDefault();applyScale(boundedZoom(scale-.25));}
            if(event.key==='0'){event.preventDefault();fit();}
          });
        }
        fit();
      }
      catch(error){if(token===revision&&frame.contentDocument===doc){get('previewCaption').textContent=`表示の準備に失敗しました：${error.message}`;controls(false);}}
    };
    frame.addEventListener('load',frameLoad);stage.replaceChildren(frame);onDocumentMove(frame);void frameLoad();get('closePreview').focus({preventScroll:true});
  }
  get('closePreview').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{if(!dialog.open&&kind)close();});
  get('zoomOut').onclick=()=>applyScale(boundedZoom(scale-.25));
  get('zoomIn').onclick=()=>applyScale(boundedZoom(scale+.25));
  get('zoomActual').onclick=()=>applyScale(1,{reset:true});
  get('zoomFit').onclick=fit;
  dialog.addEventListener('keydown',event=>{
    if(event.target instanceof HTMLInputElement||event.ctrlKey||event.metaKey)return;
    if(['+','='].includes(event.key)){event.preventDefault();applyScale(boundedZoom(scale+.25));}
    if(event.key==='-'){event.preventDefault();applyScale(boundedZoom(scale-.25));}
    if(event.key==='0'){event.preventDefault();fit();}
  });
  let resizeFrame=0,lastWidth=0,lastHeight=0;
  const resizeObserver=new ResizeObserver(()=>{
    const width=viewport.offsetWidth,height=viewport.offsetHeight;
    if(width===lastWidth&&height===lastHeight)return;
    lastWidth=width;lastHeight=height;cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(()=>{if(dialog.open&&(image||documentFrame))fit();});
  });
  resizeObserver.observe(viewport,{box:'border-box'});
  return {showImage,showDocument,close,isOpen:()=>dialog.open};
}
