import ClientHub from '@/components/ClientHub';

export const metadata = {
  title: 'Client — Drive Uploader',
  robots: { index: false, follow: false },
};

export default function ClientPage() {
  return (
    <main className="container">
      <ClientHub />
    </main>
  );
}
