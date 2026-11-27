import {layoutBitmapText} from './shared/bitmap-font.mjs';
const samples = ['123,456,789.00','$123,456,789.00','₫123,456,789.00','€123,456,789.00','R$123,456,789.00','₱123,456,789.00','฿123,456,789.00'];
export function createFontLab({app,nav,esc,isActive}) {
  const state={font:null,images:new Map(),fonts:[],folder:'',selectedPath:'',text:'123,456,789.00',size:32,spacing:0,width:640,background:'#202226',busy:false,error:''};
  function render() {
    app.innerHTML=`${nav()}<main class="module-page font-lab"><header class="module-header"><div><h1>Phòng thử font</h1><p>Thử bitmap font, ký tự tiền tệ và khoảng cách trước khi bàn giao.</p></div><div class="module-actions"><button class="primary-action" data-font-folder ${state.busy?'disabled':''}>Chọn folder font</button></div></header><section class="workspace-settings font-lab-info"><strong>${state.font?esc(state.font.face):'Chọn folder font trên máy'}</strong><span>${state.font?`${Object.keys(state.font.glyphs).length} glyph · ${state.font.pages.length} texture · ${esc(state.font.fileName)}`:'Texture PNG/JPG nằm cùng folder sẽ được tải tự động. Không cần đăng nhập.'}</span>${state.fonts.length?`<div class="font-lab-picker"><span>${state.fonts.length} font · ${esc(state.folder)}</span><div class="font-lab-fonts" role="group" aria-label="Danh sách font">${state.fonts.map(font=>`<button data-font-select="${esc(font.path)}" aria-pressed="${font.path===state.selectedPath}" ${state.busy?'disabled':''}>${esc(font.name)}</button>`).join('')}</div></div>`:''}</section>${state.error?`<div class="notice error" role="alert">${esc(state.error)}</div>`:''}<section class="font-lab-grid"><section class="workspace-settings font-lab-controls"><label><span>Nội dung thử</span><textarea rows="3" maxlength="3000" data-font-field="text">${esc(state.text)}</textarea></label><div class="font-lab-samples">${samples.map((sample,index)=>`<button data-font-sample="${index}">${esc(sample)}</button>`).join('')}</div><div class="font-lab-options"><label><span>Cỡ chữ (px)</span><input type="number" min="8" max="300" value="${state.size}" data-font-field="size"></label><label><span>Khoảng cách (px)</span><input type="number" min="-20" max="80" value="${state.spacing}" data-font-field="spacing"></label><label><span>Rộng khung (px)</span><input type="number" min="100" max="1400" value="${state.width}" data-font-field="width"></label><label><span>Màu nền</span><input type="color" value="${state.background}" data-font-field="background"></label></div></section><section class="font-lab-preview"><div class="font-lab-preview-title"><strong>Preview</strong><span data-font-measure></span></div><div class="font-lab-canvas-scroll"><canvas data-font-canvas aria-label="Preview bitmap font"></canvas></div><div class="font-lab-feedback" data-font-feedback role="status"></div><p class="font-lab-hint">Viền nét đứt là giới hạn khung. Ô đỏ là ký tự thiếu glyph. Giữ nguyên màu/texture của font gốc.</p></section></section></main>`;
    paint();
  }
  function paint() {
    const canvas=app.querySelector('[data-font-canvas]');if(!canvas)return;
    const layout=state.font?layoutBitmapText(state.font,state.text,state.size,state.spacing):null;
    const width=Math.min(1550,Math.max(state.width+48,(layout?.width||0)+48)),height=Math.min(1500,Math.max(250,(layout?.height||0)+64));
    const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.ceil(width*ratio);canvas.height=Math.ceil(height*ratio);canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
    const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle=state.background;ctx.fillRect(0,0,width,height);ctx.strokeStyle=layout?.width>state.width?'#ff8c98':'#8897a8';ctx.setLineDash([6,5]);ctx.strokeRect(24,24,state.width,Math.max(190,height-48));ctx.setLineDash([]);
    if(layout)for(const item of layout.placements) {
      if(item.missing){ctx.strokeStyle='#ff788a';ctx.strokeRect(24+item.x,24+item.y,item.width,item.height);ctx.fillStyle='#ffadb7';ctx.font='14px sans-serif';ctx.fillText(item.char,27+item.x,44+item.y);}
      else if(item.width&&item.height){const g=item.glyph;ctx.drawImage(state.images.get(g.page),g.x,g.y,g.width,g.height,24+item.x,24+item.y,item.width,item.height);}
    }
    const feedback=app.querySelector('[data-font-feedback]'),measure=app.querySelector('[data-font-measure]');
    measure.textContent=layout?`${Math.ceil(layout.width)}px / ${state.width}px`:'';
    feedback.className=`font-lab-feedback ${layout?.missing.length||layout?.width>state.width?'warning':''}`;
    feedback.textContent=!layout?'Load font để bắt đầu.':[
      layout.missing.length?`Thiếu ${layout.missing.length} ký tự: ${layout.missing.map(char=>`${char===' '?'Space':char} (U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')})`).join(' · ')}`:'Đủ glyph cho nội dung đang thử.',
      layout.width>state.width?`Tràn khung ${Math.ceil(layout.width-state.width)}px.`:'Không tràn khung.'
    ].join(' ');
  }
  async function loadFont(filePath) {
    state.busy=true;state.error='';render();
    try {
      const result=await window.spinePreview.loadBitmapFont(filePath);
      if(result?.cancelled)return;
      if(!result?.ok)throw new Error(result?.error||'Không tải được font.');
      state.font=null;state.images=new Map();state.selectedPath=filePath||'';
      const images=new Map();
      await Promise.all(result.font.pages.map(async page=>{const image=new Image();image.src=page.dataUrl;await image.decode();images.set(page.id,image);}));
      for(const [glyphId,glyph] of Object.entries(result.font.glyphs)){const image=images.get(glyph.page);if(glyph.x+glyph.width>image.naturalWidth||glyph.y+glyph.height>image.naturalHeight)throw new Error(`${result.font.fileName}: glyph U+${Number(glyphId).toString(16).toUpperCase().padStart(4,'0')} có vùng (${glyph.x}, ${glyph.y}, ${glyph.width}×${glyph.height}) vượt texture ${image.naturalWidth}×${image.naturalHeight}. Xuất lại bộ FNT và PNG cùng nhau.`);}
      state.font=result.font;state.images=images;state.selectedPath=filePath||'';
      if(!filePath){state.fonts=[];state.folder='';}
    }catch(error){state.error=error.message;}
    finally {state.busy=false;if(isActive())render();}
  }
  app.addEventListener('click',async event=>{
    if(!isActive())return;
    const fontButton=event.target.closest('[data-font-select]');
    if(fontButton){if(!state.busy)await loadFont(fontButton.dataset.fontSelect);return;}
    if(event.target.closest('[data-font-folder]')) {
      if(state.busy)return;state.busy=true;state.error='';render();
      try {
        const result=await window.spinePreview.selectBitmapFontFolder();
        if(result?.cancelled)return;
        if(!result?.ok)throw new Error(result?.error||'Không mở được folder font.');
        state.fonts=result.fonts;state.folder=result.folder;
        await loadFont(result.fonts[0].path);
      }catch(error){state.error=error.message;}
      finally{state.busy=false;if(isActive())render();}
      return;
    }
    const sample=event.target.closest('[data-font-sample]');
    if(sample){state.text=samples[Number(sample.dataset.fontSample)];app.querySelector('[data-font-field="text"]').value=state.text;paint();}
  });
  app.addEventListener('input',event=>{
    if(!isActive()||!event.target.dataset.fontField)return;
    const key=event.target.dataset.fontField;
    if(key==='text')state.text=event.target.value.slice(0,3000);
    else if(key==='background')state.background=event.target.value;
    else {const limits={size:[8,300],spacing:[-20,80],width:[100,1400]};const value=Number(event.target.value);if(!Number.isFinite(value)||!limits[key])return;state[key]=Math.max(limits[key][0],Math.min(limits[key][1],value));}
    paint();
  });
  return {render};
}
