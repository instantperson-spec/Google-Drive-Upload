import SharePage from '@/components/SharePage';

export default async function ShareRoute({ params }) {
  const { id } = await params;
  return (
    <main className="container share-container">
      <SharePage shareId={id} />
    </main>
  );
}
