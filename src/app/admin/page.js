import AdminDashboard from '@/components/AdminDashboard';

export const metadata = {
  title: 'Admin — Drive Uploader',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <main className="admin-container">
      <AdminDashboard />
    </main>
  );
}
