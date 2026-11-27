import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseBitmapFont,layoutBitmapText} from '../src/shared/bitmap-font.mjs';
const text=`info face="Test font" size=20
common lineHeight=24 base=18 pages=1
page id=0 file="font.png"
chars count=2
char id=65 x=0 y=0 width=10 height=20 xoffset=0 yoffset=0 xadvance=12 page=0
char id=86 x=10 y=0 width=10 height=20 xoffset=0 yoffset=0 xadvance=12 page=0
kerning first=65 second=86 amount=-2`;
test('text FNT preserves metrics and applies scaled kerning/spacing',()=>{
 const font=parseBitmapFont(text);assert.equal(font.face,'Test font');assert.equal(font.pages[0].file,'font.png');
 const layout=layoutBitmapText(font,'AV',40,3);assert.equal(layout.placements[1].x,23);assert.equal(layout.width,47);assert.equal(layout.height,48);
});
test('XML and JSON support multipage font and Unicode glyphs',()=>{
 const font=parseBitmapFont('<font><info face="A &amp; B" size="16"/><common lineHeight="20"/><pages><page id="0" file="a.png"/><page id="1" file="b.png"/></pages><chars><char id="8363" x="0" y="0" width="10" height="10" xadvance="12" page="1"/></chars></font>');
 assert.equal(font.face,'A & B');assert.equal(layoutBitmapText(font,'₫',16).missing.length,0);assert.equal(font.glyphs[8363].page,1);
 const json=parseBitmapFont(JSON.stringify({info:{face:'JSON',size:20},common:{lineHeight:24},pages:['font.png'],chars:[{id:65,width:10,height:20,xadvance:12}]}));assert.equal(json.glyphs[65].width,10);
});
test('missing glyphs deduplicated and newline advances line height',()=>{
 const layout=layoutBitmapText(parseBitmapFont(text),'A$$\nV',20);assert.deepEqual(layout.missing,['$']);assert.equal(layout.placements.at(-1).y,24);
});
test('reject unsupported binary, packed channels, invalid metrics/page',()=>{
 assert.throws(()=>parseBitmapFont('BMFbinary'));
 assert.throws(()=>parseBitmapFont('info face="bad"'));
 assert.throws(()=>parseBitmapFont(text.replace('base=18','base=18 packed=1')));
 assert.throws(()=>parseBitmapFont(text.replace('width=10','width=-10')));
 assert.throws(()=>parseBitmapFont(text.replace('page=0','page=2')));
});
