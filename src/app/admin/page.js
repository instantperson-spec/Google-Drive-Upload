import AdminDashboard from '@/components/AdminDashboard';

export const metadata = {
  title: 'Admin — Drive Uploader',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <main className="admin-container">
      <div className="glass-panel admin-panel">
        <h1>Admin Console</h1>
        <p className="subtitle admin-subtitle">Session history from Google Drive</p>
        <AdminDashboard />
      </div>
    </main>
  );
}
