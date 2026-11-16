import ClientUploadPage from '@/components/ClientUploadPage';

export const metadata = {
  title: 'Upload — Client hub',
  robots: { index: false, follow: false },
};

export default function ClientUploadRoute() {
  return (
    <main className="container">
      <ClientUploadPage />
    </main>
  );
}
