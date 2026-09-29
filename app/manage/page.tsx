import { requireChatGPTUser,chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { isOwner } from '@/lib/server';
import Archive from '@/components/archive';
export const dynamic='force-dynamic';
async function Workspace(){await requireChatGPTUser('/manage');if(!await isOwner())return <main className="access-page"><h1>Owner access only.</h1><p>You are signed in, but this account cannot edit the archive.</p><a className="button" href={chatGPTSignOutPath('/manage')} target="_top">Use another account</a><a href="/">Return to the public archive</a></main>;return <Archive manage/>}
export default function ManagePage(){return <Workspace/>}
