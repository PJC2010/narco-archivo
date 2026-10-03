import { LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isOwner } from '@/lib/auth';
import { isOwnerAuthConfigured } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

const messages: Record<string, string> = {
  credentials: 'We could not sign you in. Check your email and password and use the verified archive owner account.',
  unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isOwner()) redirect('/manage');
  const configured = isOwnerAuthConfigured();
  const { error } = await searchParams;
  const message = typeof error === 'string' && Object.hasOwn(messages, error) ? messages[error] : null;

  return (
    <main className="access-page">
      <Link className="brand" href="/">
        <span className="brandmark">N<span>H</span></span>
        <span>NarcoHistoria<small>A living research archive</small></span>
      </Link>
      <div>
        <h1>Owner workspace.</h1>
        <p>Sign in to research, edit, and publish archive entries.</p>
      </div>
      {!configured ? (
        <p className="error-banner" role="status">
          Owner sign-in is not available yet. The archive administrator needs to finish setting up access.
        </p>
      ) : (
        <form action="/auth/sign-in" method="post">
          {message && <p className="error-banner" role="alert">{message}</p>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required maxLength={320} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
          </div>
          <button className="button primary" type="submit"><LockKeyhole size={16} />Sign in</button>
          <p className="form-help">Access is reserved for the verified archive owner. To reset your password, contact the archive administrator.</p>
        </form>
      )}
      <Link className="text-link" href="/">Return to the public archive</Link>
    </main>
  );
}
