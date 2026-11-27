const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
function attributes(text) {
  const out = {};
  for (const match of text.matchAll(/([\w]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[match[1]] = match[2] ?? match[3] ?? match[4];
  return out;
}
export function parseBitmapFont(source) {
  if (source.startsWith('BMF')) throw new Error('Font binary chưa được hỗ trợ. Hãy export FNT dạng text hoặc XML.');
  let info = {}, common = {}, pages = [], chars = [], kernings = [];
  if (source.trim().startsWith('{')) {
    const data = JSON.parse(source); info = data.info || {}; common = data.common || {};
    pages = (data.pages || []).map((page,id) => typeof page === 'string' ? {id,file:page} : page);
    chars = data.chars || []; kernings = data.kernings || [];
  } else {
    const records = source.trim().startsWith('<')
      ? [...source.matchAll(/<(info|common|page|char|kerning)\b([^>]*)>/g)].map(m => [m[1], attributes(m[2])])
      : source.split(/\r?\n/).map(line => [line.trim().split(/\s/)[0],attributes(line)]);
    for (const [type,value] of records) {
      if (type === 'info') info = value;
      if (type === 'common') common = value;
      if (type === 'page') pages.push(value);
      if (type === 'char') chars.push(value);
      if (type === 'kerning') kernings.push(value);
    }
  }
  if (!pages.length || pages.length > 16 || !chars.length || chars.length > 100000 || number(common.lineHeight) <= 0) throw new Error('FNT không hợp lệ hoặc vượt giới hạn (tối đa 16 trang texture).');
  if (number(common.packed)) throw new Error('Font packed-channel chưa hỗ trợ. Hãy export texture RGBA thông thường.');
  const decoded = value => String(value).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  pages = pages.map(page => ({id:number(page.id),file:decoded(page.file)}));
  if (new Set(pages.map(page => page.id)).size !== pages.length || pages.some(page => !page.file || page.id < 0)) throw new Error('Danh sách page của font không hợp lệ.');
  const glyphs = {};
  for (const char of chars) {
    const id = Number(char.id);
    if (!Number.isInteger(id) || id < 0 || id > 0x10ffff) continue;
    const glyph = Object.fromEntries(['x','y','width','height','xoffset','yoffset','xadvance','page'].map(key => [key,number(char[key])]));
    if ([glyph.x,glyph.y,glyph.width,glyph.height].some(value => value < 0) || !pages.some(page => page.id === glyph.page)) throw new Error(`Glyph ${id} có tọa độ/page không hợp lệ.`);
    glyphs[id] = glyph;
  }
  const kerning = {};
  for (const pair of kernings) kerning[`${number(pair.first)}:${number(pair.second)}`] = number(pair.amount);
  return {face:decoded(info.face || 'Bitmap Font'),size:Math.abs(number(info.size)) || number(common.lineHeight),lineHeight:number(common.lineHeight),base:number(common.base),pages,glyphs,kerning};
}
export function layoutBitmapText(font,text,size,spacing=0) {
  const scale = size / font.size, lines = String(text).replace(/\r/g,'').split('\n'), placements = [], missing = new Set();
  let maxWidth=0;
  lines.forEach((line,lineIndex) => {
    let pen=0, previous=null, right=0;
    for (const char of Array.from(line)) {
      const id=char.codePointAt(0),glyph=font.glyphs[id];
      if (previous !== null) pen += (font.kerning[`${previous}:${id}`] || 0)*scale + spacing;
      if (!glyph) {
        missing.add(char);placements.push({char,missing:true,x:pen,y:lineIndex*font.lineHeight*scale,width:size*.55,height:size});
        pen+=size*.6;right=Math.max(right,pen);
      } else {
        placements.push({char,x:pen+glyph.xoffset*scale,y:(lineIndex*font.lineHeight+glyph.yoffset)*scale,width:glyph.width*scale,height:glyph.height*scale,glyph});
        right=Math.max(right,pen+(glyph.xoffset+glyph.width)*scale);pen+=glyph.xadvance*scale;
      }
      previous=id;
    }
    maxWidth=Math.max(maxWidth,right,pen);
  });
  return {placements,missing:[...missing],width:maxWidth,height:lines.length*font.lineHeight*scale};
}
