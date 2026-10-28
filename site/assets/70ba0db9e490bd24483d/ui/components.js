/** Stateless presentation primitives. No model, browser storage, or business decisions. */
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const flags=new Set(['disabled','required','checked','hidden','open','multiple','selected','readonly','autofocus']);
export function attrs(values={}){
  return Object.entries(values).filter(([,v])=>v!==null&&v!==undefined).map(([key,value])=>{
    if(!/^[a-zA-Z][a-zA-Z0-9_:-]*$/.test(key)||/^on/i.test(key))throw new Error(`表示属性を確認してください：${key}`);
    if(flags.has(key))return value?` ${key}`:'';
    return ` ${key}="${escapeHTML(value)}"`;
  }).join('');
}
const classes=(...values)=>values.filter(Boolean).join(' ');
const headingLevel=value=>[2,3,4].includes(value)?value:2;
export function optionItems(items,selected){
  return items.map(item=>{const [value,label]=Array.isArray(item)?item:[item,item];return `<option${attrs({value,selected:value===selected})}>${escapeHTML(label)}</option>`;}).join('');
}

export function button(label,{id,variant='default',type='button',className='',attrs:attributes={},html=false}={}){
  if(!['default','primary','subtle','danger','icon'].includes(variant))throw new Error('ボタンの種類を確認してください。');
  return `<button${attrs({id,type,class:classes('button',variant==='icon'?'icon-button':variant==='default'?'':variant,className),...attributes})}>${html?label:escapeHTML(label)}</button>`;
}
export const actions=(content,{className='',attrs:attributes={}}={})=>`<div${attrs({class:classes('ui-actions',className),...attributes})}>${content}</div>`;


/** An operation and its explanation share one vertical spacing contract. */
export function actionBlock(content,hint,{className=''}={}){
  return `<div class="${escapeHTML(classes('ui-action-block',className))}">${actions(content)}<p class="hint">${escapeHTML(hint)}</p></div>`;
}

function fieldMarkup(label,control,{hint='',error='',className=''}={}){
  return `<label class="${escapeHTML(classes('ui-field',className))}"><span class="ui-field-label">${escapeHTML(label)}</span>${control}${hint?`<small class="hint">${escapeHTML(hint)}</small>`:''}${error?`<small class="field-error" role="alert">${escapeHTML(error)}</small>`:''}</label>`;
}
export function textField(label,{name,id,value='',type='text',max=300,required=true,attrs:attributes={},...layout}={}){
  return fieldMarkup(label,`<input${attrs({name,id,type,value,maxlength:max,required,...attributes})}>`,layout);
}
export function textareaField(label,{name,id,value='',max=300,required=true,rows,attrs:attributes={},...layout}={}){
  return fieldMarkup(label,`<textarea${attrs({name,id,maxlength:max,required,rows,...attributes})}>${escapeHTML(value)}</textarea>`,layout);
}
export function selectField(label,optionHTML,{name,id,attrs:attributes={},...layout}={}){
  return fieldMarkup(label,`<select${attrs({name,id,...attributes})}>${optionHTML}</select>`,layout);
}
export function checkbox(label,{id,name,checked=false,required=false,description='',attrs:attributes={},className=''}={}){
  return `<label class="${escapeHTML(classes('checkbox',className))}"><input${attrs({type:'checkbox',id,name,checked,required,...attributes})}><span>${escapeHTML(label)}${description?`<small>${escapeHTML(description)}</small>`:''}</span></label>`;
}

const disclosureKinds=['section','control','menu','panel','compact'];
export function disclosure(label,body,{id,className='',kind='section',open=false,summaryId,saveKey,labelHTML=false,bodyClass='',floating,attrs:attributes={}}={}){
  if(!disclosureKinds.includes(kind))throw new Error('折り畳みの種類を確認してください。');
  return `<details${attrs({id,class:classes('ui-disclosure',`ui-disclosure--${kind}`,className),'data-disclosure':saveKey,'data-floating':floating,open,...attributes})}><summary${attrs({id:summaryId,class:'ui-disclosure-summary'})}><span class="disclosure-label">${labelHTML?label:escapeHTML(label)}</span></summary><div class="${escapeHTML(classes('ui-disclosure-body',bodyClass))}">${body}</div></details>`;
}
export function panelHeading(title,{eyebrow='',description='',actions:actionHTML='',meta='',level=2,className=''}={}){
  const h=headingLevel(level);
  return `<header class="${escapeHTML(classes('ui-panel-heading',className))}"><div class="ui-panel-heading-main">${eyebrow?`<span class="eyebrow">${escapeHTML(eyebrow)}</span>`:''}<h${h}>${escapeHTML(title)}</h${h}>${description?`<p class="hint">${escapeHTML(description)}</p>`:''}</div>${meta?`<div class="ui-panel-heading-meta">${meta}</div>`:''}${actionHTML?`<div class="ui-panel-heading-actions">${actionHTML}</div>`:''}</header>`;
}
export function badge(label,{tone='muted',className='',attrs:attributes={}}={}){
  if(!['success','warning','danger','muted'].includes(tone))throw new Error('状態表示の種類を確認してください。');
  return `<span${attrs({class:classes('badge',`badge--${tone}`,className),...attributes})}>${escapeHTML(label)}</span>`;
}
export function notice(content,{tone='info',id,role='status',html=false,className='',attrs:attributes={}}={}){
  if(!['info','warning','error'].includes(tone))throw new Error('案内の種類を確認してください。');
  return `<div${attrs({id,class:classes('notice',tone==='info'?'':tone,className),role,...attributes})}>${html?content:escapeHTML(content)}</div>`;
}
export function photoMeta({name='',title='',details=[],className=''}={}){
  return `<div class="${escapeHTML(classes('photo-meta',className))}">${title?`<strong>${escapeHTML(title)}</strong>`:''}${name?`<p class="photo-meta-name">${escapeHTML(name)}</p>`:''}${details.map(value=>`<p>${escapeHTML(value)}</p>`).join('')}</div>`;
}
export function metaList(entries,{className=''}={}){
  return `<dl class="${escapeHTML(classes('ui-meta-list',className))}">${entries.map(([key,value])=>`<div><dt>${escapeHTML(key)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>`;
}
export function tabButton(label,{selected=false,attrs:attributes={},className=''}={}){
  return button(label,{className:classes('ui-tab',selected?'selected':'',className),attrs:{...(Object.hasOwn(attributes,'aria-current')?{}:{'aria-pressed':String(selected)}),...attributes}});
}
export function tabBar(content,{label='',className='',role='group'}={}){
  const tag=role==='navigation'?'nav':'div';
  return `<${tag}${attrs({class:classes('ui-tabs',className),role:tag==='div'?role:undefined,'aria-label':label||undefined})}>${content}</${tag}>`;
}
export function emptyState(title,description='',{actions:actionHTML='',level=2,className=''}={}){
  const h=headingLevel(level);
  return `<section class="${escapeHTML(classes('empty-state',className))}"><h${h}>${escapeHTML(title)}</h${h}>${description?`<p>${escapeHTML(description)}</p>`:''}${actionHTML?actions(actionHTML):''}</section>`;
}
export function inlineName({id,name,draft,editing=false,floating=false}){
  const form=`<form class="inline-name" data-inline-target="${escapeHTML(id)}">${textField('管理名',{name:'name',value:draft??name,attrs:{'data-name-draft':id}})}${button('保存',{type:'submit',variant:'primary'})}${button('取消',{attrs:{'data-cancel-name':id}})}<small>編集中です。既存写真の黒板は変わりません。</small></form>`;
  if(floating)return `<div class="inline-name-label"><strong>${escapeHTML(name)}</strong>${disclosure('管理名を編集',form,{kind:'menu',floating:'wide',className:'inline-name-editor',saveKey:`name-${id}`,open:editing,attrs:{'data-name-editor':id}})}</div>`;
  return editing?form:`<div class="inline-name-label"><strong>${escapeHTML(name)}</strong>${button('管理名を編集',{variant:'subtle',attrs:{'data-start-name':id,'aria-label':`${name}の管理名を編集`}})}</div>`;
}

export function dialogHeading(title,{titleId,closeId,closeLabel='閉じる',className=''}={}){
  return `<header class="${escapeHTML(classes('dialog-heading',className))}"><h2${attrs({id:titleId})}>${escapeHTML(title)}</h2>${button('×',{id:closeId,variant:'icon',attrs:{'aria-label':closeLabel}})}</header>`;
}
export function editorDialogFrame(){
  return `<dialog id="editorDialog" class="ui-dialog ui-dialog--editor" aria-labelledby="dialogTitle"><form id="editorForm">${dialogHeading('',{titleId:'dialogTitle',closeId:'closeDialog'})}<div id="dialogBody" class="ui-dialog-body"></div><p id="dialogError" class="field-error" role="alert" hidden></p>${actions(button('キャンセル',{id:'cancelDialog'})+button('保存する',{id:'dialogSubmit',type:'submit',variant:'primary'}),{className:'dialog-actions'})}</form></dialog>`;
}
export function photoDrawerFrame(){
  return `<dialog id="photoDrawer" class="ui-dialog ui-dialog--drawer photo-drawer" aria-labelledby="photoDrawerTitle">${dialogHeading('写真の詳細',{titleId:'photoDrawerTitle',closeId:'closePhotoDrawer',closeLabel:'写真の詳細を閉じる',className:'drawer-header'})}<div id="photoDrawerBody" class="drawer-body ui-dialog-body"></div></dialog>`;
}
export function previewDialogFrame(){
  return `<dialog id="previewDialog" class="ui-dialog ui-dialog--preview preview-dialog" aria-labelledby="previewTitle"><header class="preview-toolbar"><div class="preview-heading"><h2 id="previewTitle" class="preview-title">拡大表示</h2><p id="previewCaption" class="preview-caption"></p></div><div class="preview-actions" aria-label="表示倍率">${button('−',{id:'zoomOut',attrs:{'aria-label':'縮小'}})}<output id="zoomLabel" aria-live="polite">100%</output>${button('＋',{id:'zoomIn',attrs:{'aria-label':'拡大'}})}${button('<span class="zoom-fit-full">画面に合わせる</span><span class="zoom-fit-short" aria-hidden="true">全体</span>',{id:'zoomFit',html:true,attrs:{'aria-label':'画面に合わせる'}})}${button('100%',{id:'zoomActual'})}${button('×',{id:'closePreview',variant:'icon',attrs:{'aria-label':'拡大表示を閉じる'}})}</div></header><div id="previewViewport" class="preview-viewport"><div id="previewStage" class="preview-stage"></div></div></dialog>`;
}
