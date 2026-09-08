import Uploader from '../components/Uploader';

export default function Home() {
  return (
    <main className="container">
      <div className="glass-panel">
        <h1>Send Files</h1>
        <p className="subtitle">Please select and upload your files here.</p>
        <Uploader />
      </div>
    </main>
  );
}
