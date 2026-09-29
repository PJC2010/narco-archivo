import { z } from 'zod';
export const kinds=['Person','Organization','Faction','Armed wing'] as const;
export const roles=['Main boss','Lieutenant','Plaza boss','Member','Faction','Armed wing','Associated with','Predecessor'] as const;
export const evidence=['Documented','Alleged','Disputed','Unverified'] as const;
const day=z.string().refine(v=>!v||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),'Use a valid date');
const url=z.string().max(2000).refine(v=>{if(!v)return true;try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!!u.hostname}catch{return false}},'Use an http or https URL');
const id=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const sourceSchema=z.object({id,title:z.string().min(1).max(300),publisher:z.string().max(200),url,date:day,note:z.string().max(3000)});
export const relationSchema=z.object({id,parentId:id,role:z.enum(roles),certainty:z.enum(evidence),from:day,to:day,asOf:day,sourceIds:z.array(id).max(50),note:z.string().max(3000)}).refine(r=>!r.from||!r.to||r.from<=r.to,'Relationship end must follow its start');
export const imageSchema=z.object({key:z.string().regex(/^[a-f0-9-]+\.(jpg|png|webp)$/),caption:z.string().max(500),credit:z.string().max(300),sourceUrl:url,identity:z.enum(['Identified by source','Alleged identification','Identity disputed']),rights:z.string().max(500)});
export const entrySchema=z.object({id,name:z.string().trim().min(1,'A name is required').max(200),kind:z.enum(kinds),aliases:z.string().max(1000),summary:z.string().max(1500),body:z.string().max(80000),status:z.enum(['Draft','Published']),certainty:z.enum(evidence),asOf:day,period:z.string().max(120),sources:z.array(sourceSchema).max(100),relations:z.array(relationSchema).max(100),images:z.array(imageSchema).max(30),version:z.number().int().nonnegative(),updatedAt:z.string().max(50)}).superRefine((e,c)=>{
 const ids=new Set(e.sources.map(s=>s.id));
 if(ids.size!==e.sources.length)c.addIssue({code:'custom',message:'Source IDs must be unique'});
 for(const r of e.relations){if(r.parentId===e.id)c.addIssue({code:'custom',message:'An entry cannot be its own parent'});if(r.sourceIds.some(x=>!ids.has(x)))c.addIssue({code:'custom',message:'A relationship references a missing source'});}
 if(e.status==='Published'){
  if(!e.summary.trim()||!e.asOf||!e.sources.length)c.addIssue({code:'custom',message:'Publishing requires a summary, review date, and at least one source'});
  if(e.sources.some(s=>!s.url))c.addIssue({code:'custom',message:'Published sources need a URL'});
  if(e.relations.some(r=>!r.sourceIds.length||!r.asOf))c.addIssue({code:'custom',message:'Published relationships need a source and an as-of date'});
  if(e.images.some(i=>!i.credit.trim()||!i.sourceUrl||!i.caption.trim()||!i.rights.trim()))c.addIssue({code:'custom',message:'Published images need a caption, credit, source URL, and rights note'});
 }
});
export type Entry=z.infer<typeof entrySchema>;
export type Source=z.infer<typeof sourceSchema>;
export type Relation=z.infer<typeof relationSchema>;
export type ArchiveImage=z.infer<typeof imageSchema>;
export function newEntry():Entry{return {id:crypto.randomUUID(),name:'',kind:'Person',aliases:'',summary:'',body:'',status:'Draft',certainty:'Unverified',asOf:'',period:'',sources:[],relations:[],images:[],version:0,updatedAt:''}}
export function activeRelation(r:Relation,date:string){return !date||((!r.from||r.from<=date)&&(!r.to||r.to>=date))}
export function imageUrl(key:string){return `/api/images/${encodeURIComponent(key)}`}
export function dateLabel(value:string){if(!value)return 'Undated';return new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}
