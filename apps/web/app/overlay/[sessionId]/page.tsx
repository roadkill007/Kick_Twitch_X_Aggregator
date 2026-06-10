import { OverlayClient } from './overlay-client';

export default async function OverlayPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ token?: string }> }) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  return <OverlayClient sessionId={sessionId} token={query.token ?? ''} />;
}
