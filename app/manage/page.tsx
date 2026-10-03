import { requireOwner } from '@/lib/auth';
import Archive from '@/components/archive';

export const dynamic = 'force-dynamic';

export default async function ManagePage() {
  await requireOwner();
  return <Archive manage />;
}
