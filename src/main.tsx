import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const RealtimePreview = lazy(() => import('./components/RealtimePreview'));
const App = lazy(() => import('./App'));
const realtime = new URLSearchParams(window.location.search).get('render') !== 'video';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="loading-screen" role="status">PREPARING THE SCENE</div>}>
      {realtime ? <RealtimePreview /> : <App />}
    </Suspense>
  </React.StrictMode>,
);
