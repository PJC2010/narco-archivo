import assert from 'node:assert/strict';
const base='http://127.0.0.1:5173';
const cookie='__sites_local_auth=1';
const owned=[];
const make=(name,kind='Organization')=>({id:crypto.randomUUID(),name,kind,aliases:'',summary:'Synthetic local test record, not factual archive content.',body:'Test paragraph one.\n\nTest paragraph two.',status:'Draft',certainty:'Unverified',asOf:'2026-09-29',period:'',sources:[{id:crypto.randomUUID(),title:'Synthetic test reference',publisher:'Test fixture',url:'https://example.com',date:'2026-09-29',note:'Test only.'}],relations:[],images:[],version:0,updatedAt:''});
async function call(path,method='GET',body,owner=false,origin=base){const headers={...(owner?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:origin}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})};const r=await fetch(base+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const type=r.headers.get('content-type');return{status:r.status,data:type?.includes('json')?await r.json():await r.text()};}
async function save(e){const r=await call('/api/entries','POST',e,true);assert.equal(r.status,200,JSON.stringify(r.data));const n=r.data.entry;const ix=owned.findIndex(x=>x.id===n.id);if(ix<0)owned.push(n);else owned[ix]=n;return n;}
try{
 const publicRead=await call('/api/entries');assert.equal(publicRead.status,200);assert.equal(publicRead.data.canEdit,false);
 const anonymous=await call('/api/entries','POST',make('Denied'));assert.equal(anonymous.status,403);
 assert.equal((await call('/api/entries?export=1')).status,403);
 assert.equal((await call('/api/entries','POST',make('Cross-origin'),true,'https://example.net')).status,403);
 let organization=await save(make('LOCAL TEST Organization'));
 assert.ok(!(await call('/api/entries')).data.entries.some(e=>e.id===organization.id));
 assert.ok((await call('/api/entries','GET',undefined,true)).data.entries.some(e=>e.id===organization.id));
 organization=await save({...organization,status:'Published'});
 assert.ok((await call('/api/entries')).data.entries.some(e=>e.id===organization.id));
 let person=make('LOCAL TEST Person','Person');person.relations=[{id:crypto.randomUUID(),parentId:organization.id,role:'Lieutenant',certainty:'Alleged',from:'2020-01-01',to:'2021-01-01',asOf:'2021-01-01',sourceIds:[person.sources[0].id],note:'Synthetic relationship'}];
 const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSm0AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'test.png');
 assert.equal((await call('/api/uploads','POST',form)).status,403);
 const upload=await call('/api/uploads','POST',form,true);assert.equal(upload.status,200,JSON.stringify(upload.data));
 person.images=[{key:upload.data.key,caption:'Synthetic image for testing',credit:'Local test',sourceUrl:'https://example.com',identity:'Alleged identification',rights:'Test fixture'}];
 person=await save(person);
 assert.equal((await call('/api/images/'+upload.data.key)).status,404);
 assert.equal((await call('/api/images/'+upload.data.key,'GET',undefined,true)).status,200);
 const stale={...person};person=await save({...person,status:'Published'});
 assert.equal((await call('/api/entries','POST',stale,true)).status,409);
 assert.equal((await call('/api/images/'+upload.data.key)).status,200);
 const circular={...organization,relations:[{...person.relations[0],id:crypto.randomUUID(),parentId:person.id,sourceIds:[organization.sources[0].id]}]};
 assert.equal((await call('/api/entries','POST',circular,true)).status,400);
 assert.equal((await call('/api/entries','DELETE',{id:organization.id,version:organization.version},true)).status,409);
 const exportResult=await call('/api/entries?export=1','GET',undefined,true);assert.equal(exportResult.status,200);assert.equal(exportResult.data.format,'NarcoHistoria');
 person=await save({...person,status:'Draft'});assert.equal((await call('/api/images/'+upload.data.key)).status,404);
 const invalid={...person,status:'Published',sources:[],relations:[]};assert.equal((await call('/api/entries','POST',invalid,true)).status,400);
 const badForm=new FormData();badForm.append('file',new Blob(['<svg/>'],{type:'image/svg+xml'}),'test.svg');assert.equal((await call('/api/uploads','POST',badForm,true)).status,400);
 console.log('PASS: owner/public access, CSRF rejection, durable CRUD, draft visibility, publishing, image upload/access, conflict rejection, cycle detection, linked deletion protection, export, and input validation.');
}finally{for(const e of owned.reverse()){const r=await call('/api/entries','DELETE',{id:e.id,version:e.version},true);assert.equal(r.status,200,JSON.stringify(r.data));}console.log('Synthetic records removed; public archive remains empty.');}
