import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Global error handlers to intercept Firestore quota exhaustion and Vite websocket closure
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = String(reason?.message || reason || '');
    const code = String(reason?.code || '');
    if (code === 'resource-exhausted' || msg.includes('Quota exceeded') || msg.includes('resource-exhausted')) {
      try {
        sessionStorage.setItem('fs_quota_exceeded', 'true');
        sessionStorage.setItem('fs_quota_exceeded_time', String(Date.now()));
        window.dispatchEvent(new CustomEvent('firestore-quota-exceeded'));
      } catch {}
      event.preventDefault();
      return;
    }
    if (msg.includes('WebSocket') || msg.includes('vite')) {
      event.preventDefault();
      return;
    }
  });

  window.addEventListener('error', (event) => {
    const msg = String(event.message || '');
    if (msg.includes('Quota exceeded') || msg.includes('resource-exhausted')) {
      try {
        sessionStorage.setItem('fs_quota_exceeded', 'true');
        sessionStorage.setItem('fs_quota_exceeded_time', String(Date.now()));
        window.dispatchEvent(new CustomEvent('firestore-quota-exceeded'));
      } catch {}
      event.preventDefault();
      return;
    }
    if (msg.includes('WebSocket') || msg.includes('vite')) {
      event.preventDefault();
      return;
    }
  });
}

if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) {
        reg.unregister();
      }
    });
    if ('caches' in window) {
      caches.keys().then((names) => {
        for (const name of names) {
          caches.delete(name);
        }
      });
    }
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.log('SW registration failed: ', err);
      });
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
